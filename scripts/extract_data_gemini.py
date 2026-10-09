import os
import json
import time
from google import genai
from google.genai import types
from google.genai.errors import APIError
from pydantic import BaseModel, Field

# Setup API Key from environment or hardcoded (for testing as requested)
API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    raise SystemExit("Set the GEMINI_API_KEY environment variable before running this script.")
client = genai.Client(api_key=API_KEY)

MODEL_ID = 'gemini-2.5-flash' # Use the latest flash model

INPUT_FILE = r"C:\GitHub\geno\Cartago.txt"
OUTPUT_DIR = r"C:\GitHub\geno\scripts\data\gemini_output"
os.makedirs(OUTPUT_DIR, exist_ok=True)

EVENTS_OUT_FILE = os.path.join(OUTPUT_DIR, "gemini_events.jsonl")
PEOPLE_OUT_FILE = os.path.join(OUTPUT_DIR, "gemini_people.jsonl")
PROGRESS_FILE = os.path.join(OUTPUT_DIR, "extraction_progress.json")

class Relationship(BaseModel):
    person_name: str = Field(description="The name of the related person")
    relationship_type: str = Field(description="Type of relationship (e.g., 'spouse', 'son', 'colleague', 'debtor')")

class PersonProfile(BaseModel):
    name: str = Field(description="Full name of the person")
    role: str | None = Field(description="Occupation, title, or role (e.g., Gobernador, Escribano, Indio, Mercader)")
    inferred_age_or_birth: str | None = Field(description="Any mentioned age or inferred birth year")
    relationships: list[Relationship] = Field(description="Known relationships to other people in this chunk")

class HistoricalEvent(BaseModel):
    year: str | None = Field(description="The year the event took place, if mentioned")
    date: str | None = Field(description="The month and day, e.g., 'Jan 24'")
    locations: list[str] = Field(description="Locations mentioned (e.g., Cartago, Ujarraz)")
    people_involved: list[str] = Field(description="Names of people involved in this specific event")
    summary: str = Field(description="A 2-3 sentence summary of what happened")

class ExtractionResult(BaseModel):
    events: list[HistoricalEvent]
    people: list[PersonProfile]

def chunk_text(text, chunk_lines=100):
    """Split the 139k line text into processable chunks for the LLM."""
    lines = text.split('\n')
    chunks = []
    for i in range(0, len(lines), chunk_lines):
        chunks.append("\n".join(lines[i:i+chunk_lines]))
    return chunks

def process_chunk_with_retry(chunk_text, chunk_index, max_retries=5):
    prompt = f"""
    You are an expert historical archivist analyzing an early Spanish colonial registry from Costa Rica/Guatemala.
    Extract the distinct Historical Events and detailed Person Profiles from the following text chunk.
    Merge details if the same person is mentioned multiple times in this chunk.
    Ensure dates and years are captured if present.
    
    TEXT CHUNK:
    {chunk_text}
    """
    
    retries = 0
    backoff = 5 # Start with 5 seconds

    while retries <= max_retries:
        try:
            response = client.models.generate_content(
                model=MODEL_ID,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=ExtractionResult,
                    temperature=0.1,
                ),
            )
            return json.loads(response.text)
        except Exception as e:
            # Check if it is a 429 Resource Exhausted / Rate Limit error
            error_str = str(e).lower()
            if "429" in error_str or "quota" in error_str or "rate limit" in error_str:
                print(f"  [Chunk {chunk_index}] Rate limit hit. Retrying in {backoff} seconds... ({retries+1}/{max_retries})")
                time.sleep(backoff)
                retries += 1
                backoff *= 2 # Exponential backoff
            else:
                print(f"  [Chunk {chunk_index}] Unexpected Error: {e}")
                # We don't retry on other errors, just return None so we can log and continue
                return None
                
    print(f"  [Chunk {chunk_index}] Failed after {max_retries} rate limit retries.")
    return None

def load_progress():
    """Load the indices of chunks that have already been processed successfully."""
    if os.path.exists(PROGRESS_FILE):
        try:
            with open(PROGRESS_FILE, 'r') as f:
                data = json.load(f)
                return set(data.get("processed_chunks", []))
        except Exception:
            return set()
    return set()

def save_progress(processed_chunks_set):
    """Save the set of processed chunk indices."""
    with open(PROGRESS_FILE, 'w') as f:
        json.dump({"processed_chunks": list(processed_chunks_set)}, f)

def append_to_jsonl(filename, items):
    """Append a list of dictionaries to a JSON Lines file."""
    if not items:
        return
    with open(filename, 'a', encoding='utf-8') as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')

def main():
    print(f"Reading {INPUT_FILE}...")
    try:
        with open(INPUT_FILE, 'r', encoding='utf-8') as f:
            text = f.read()
    except Exception as e:
        print(f"Error reading input file: {e}")
        return
        
    chunks = chunk_text(text, chunk_lines=200) # Adjust based on token limits
    total_chunks = len(chunks)
    print(f"Created {total_chunks} chunks to process.")
    
    processed_chunks = load_progress()
    print(f"Found {len(processed_chunks)} previously processed chunks.")
    
    chunks_to_process = total_chunks - len(processed_chunks)
    if chunks_to_process == 0:
        print("All chunks have already been processed!")
        return
        
    print(f"Remaining chunks to process: {chunks_to_process}")
    
    start_time = time.time()
    chunks_processed_this_run = 0
    
    # Processing the entire file
    for i, chunk in enumerate(chunks):
        if i in processed_chunks:
            continue
            
        print(f"Processing chunk {i+1} / {total_chunks}...")
        
        chunk_start_time = time.time()
        result = process_chunk_with_retry(chunk, i)
        
        if result:
            events = result.get("events", [])
            people = result.get("people", [])
            
            # Save incrementally
            append_to_jsonl(EVENTS_OUT_FILE, events)
            append_to_jsonl(PEOPLE_OUT_FILE, people)
            
            # Mark as processed
            processed_chunks.add(i)
            save_progress(processed_chunks)
            
            chunks_processed_this_run += 1
            
            # Calculate and display ETA
            elapsed_time = time.time() - start_time
            avg_time_per_chunk = elapsed_time / chunks_processed_this_run
            remaining_chunks = total_chunks - len(processed_chunks)
            eta_seconds = avg_time_per_chunk * remaining_chunks
            
            print(f"  -> Extracted {len(events)} events, {len(people)} people.")
            print(f"  -> Avg time per chunk: {avg_time_per_chunk:.2f}s | ETA: {eta_seconds/60:.2f} minutes")
        else:
            print(f"  -> Chunk {i+1} failed and was skipped. It will be retried on the next run.")
            
        # Optional: slight delay between successful calls if needed
        # time.sleep(1) 
        
    print("\n" + "="*50)
    print(f"Extraction job completed! Processed {len(processed_chunks)} / {total_chunks} chunks.")
    print(f"Output saved incrementally to:")
    print(f"  - {EVENTS_OUT_FILE}")
    print(f"  - {PEOPLE_OUT_FILE}")

if __name__ == "__main__":
    main()
