import os
import json
import time
from google import genai
from google.genai import types

# Setup API Key from environment or hardcoded
API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    raise SystemExit("Set the GEMINI_API_KEY environment variable before running this script.")
client = genai.Client(api_key=API_KEY)

MODEL_ID = 'gemini-2.5-flash'

INPUT_FILE = r"C:\GitHub\geno\scripts\data\gemini_output\gemini_events.jsonl"
OUTPUT_DIR = r"C:\GitHub\geno\scripts\data\gemini_output"
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "gemini_events_es.jsonl")
PROGRESS_FILE = os.path.join(OUTPUT_DIR, "translation_progress.json")

# How many events to send to Gemini in a single prompt
BATCH_SIZE = 50 

def load_events():
    events = []
    if os.path.exists(INPUT_FILE):
        with open(INPUT_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    events.append(json.loads(line))
    return events

def translate_batch_with_retry(events_batch, batch_index, max_retries=5):
    # Prepare the payload for translation
    payload_to_translate = []
    for i, event in enumerate(events_batch):
        # We only need to translate the summary. The rest (names, locations, dates) is fine in original or structured format.
        payload_to_translate.append({
            "id": i,
            "summary": event.get("summary", "")
        })
        
    prompt = f"""
    You are a professional English to Spanish translator specializing in historical documents.
    Translate the 'summary' field of the following JSON array from English to Spanish.
    Maintain the exact same JSON array structure, but swap the English text for Spanish text.
    Do not translate names of people or specific locations. 
    Return ONLY a valid JSON array of objects with 'id' and 'summary_es' fields.
    
    JSON TO TRANSLATE:
    {json.dumps(payload_to_translate, indent=2)}
    """
    
    retries = 0
    backoff = 2

    while retries <= max_retries:
        try:
            response = client.models.generate_content(
                model=MODEL_ID,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.1,
                ),
            )
            
            translated_data = json.loads(response.text)
            
            # Map the translations back to the original full event objects
            translated_events = []
            for i, event in enumerate(events_batch):
                # Copy original event
                new_event = dict(event)
                # Find the corresponding translation
                translation_match = next((item for item in translated_data if item.get("id") == i), None)
                if translation_match and "summary_es" in translation_match:
                    new_event["summary_es"] = translation_match["summary_es"]
                else:
                    new_event["summary_es"] = new_event["summary"] # fallback
                translated_events.append(new_event)
                
            return translated_events
            
        except Exception as e:
            error_str = str(e).lower()
            if "429" in error_str or "quota" in error_str or "rate limit" in error_str:
                print(f"  [Batch {batch_index}] Rate limit hit. Retrying in {backoff} seconds... ({retries+1}/{max_retries})")
                time.sleep(backoff)
                retries += 1
                backoff *= 2
            else:
                print(f"  [Batch {batch_index}] Unexpected Error: {e}")
                import traceback
                traceback.print_exc()
                return None
                
    print(f"  [Batch {batch_index}] Failed to translate after {max_retries} rate limit retries.")
    return None

def load_progress():
    if os.path.exists(PROGRESS_FILE):
        try:
            with open(PROGRESS_FILE, 'r') as f:
                data = json.load(f)
                return set(data.get("processed_batches", []))
        except Exception:
            return set()
    return set()

def save_progress(processed_batches_set):
    with open(PROGRESS_FILE, 'w') as f:
        json.dump({"processed_batches": list(processed_batches_set)}, f)

def append_to_jsonl(filename, items):
    if not items:
        return
    with open(filename, 'a', encoding='utf-8') as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')

def main():
    print("Loading events...")
    all_events = load_events()
    total_events = len(all_events)
    print(f"Loaded {total_events} events to translate.")
    
    if total_events == 0:
        print("No events found in input file.")
        return
        
    # Split into batches
    batches = []
    for i in range(0, total_events, BATCH_SIZE):
        batches.append(all_events[i:i + BATCH_SIZE])
        
    total_batches = len(batches)
    print(f"Split into {total_batches} batches of {BATCH_SIZE} events each.")
    
    processed_batches = load_progress()
    print(f"Found {len(processed_batches)} previously processed batches.")
    
    batches_to_process = total_batches - len(processed_batches)
    if batches_to_process == 0:
        print("All batches have already been translated!")
        return
        
    print(f"Remaining batches to translate: {batches_to_process}")
    
    start_time = time.time()
    batches_processed_this_run = 0
    
    for i, batch in enumerate(batches):
        if i in processed_batches:
            continue
            
        print(f"Translating batch {i+1} / {total_batches} (Events {i*BATCH_SIZE} to {min((i+1)*BATCH_SIZE, total_events)})...")
        
        translated_batch = translate_batch_with_retry(batch, i)
        
        if translated_batch:
            # Save incrementally
            append_to_jsonl(OUTPUT_FILE, translated_batch)
            
            # Mark as processed
            processed_batches.add(i)
            save_progress(processed_batches)
            
            batches_processed_this_run += 1
            
            # Calculate and display ETA
            elapsed_time = time.time() - start_time
            avg_time_per_batch = elapsed_time / batches_processed_this_run
            remaining_batches = total_batches - len(processed_batches)
            eta_seconds = avg_time_per_batch * remaining_batches
            
            print(f"  -> Translated {len(translated_batch)} events.")
            print(f"  -> Avg time per batch: {avg_time_per_batch:.2f}s | ETA: {eta_seconds/60:.2f} minutes")
        else:
            print(f"  -> Batch {i+1} failed and was skipped. It will be retried on the next run.")
            
    print("\n" + "="*50)
    print(f"Translation job completed! Processed {len(processed_batches)} / {total_batches} batches.")
    print(f"Output saved incrementally to: {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
