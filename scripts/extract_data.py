import os
import re
import json

# Paths
INPUT_FILE = r"C:\GitHub\geno\Cartago.txt"
OUTPUT_DIR = r"C:\GitHub\geno\scripts\data"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Regex Patterns (Initial heuristics based on text structure)
# Dates often appear at the start of entries like "En. 24—", "Mzo. 31—"
date_pattern = re.compile(r'^(En\.|Feb\.|Mzo\.|Ab\.|My\.|Jn\.|Jl\.|Ag\.|Set\.|Oct\.|Nov\.|Dic\.|[A-Z][a-z]{2}\.)\s*(\d+)—?(.*)')
year_pattern = re.compile(r'^Año\s*(\d{4})')

import spacy

try:
    nlp = spacy.load("es_core_news_md")
except OSError:
    print("Warning: spaCy model 'es_core_news_md' not found. Ensure it is downloaded.")
    nlp = None

def extract_entities(text):
    """
    Given a block of text, extract people, locations, and the core event using spaCy.
    """
    people = []
    locations = []
    
    if nlp is not None:
        doc = nlp(text)
        for ent in doc.ents:
            if ent.label_ == "PER":
                if ent.text not in people and len(ent.text) > 2:
                    people.append(ent.text)
            elif ent.label_ in ["LOC", "ORG", "GPE"]:
                # Using GPE (Geo-Political Entity), LOC (Location), ORG (Organization) 
                if ent.text not in locations and len(ent.text) > 2:
                    locations.append(ent.text)
    
    # Still include our known historical locations just in case the model misses them 
    # due to archaic spelling
    known_locs = ['Cartago', 'Guatemala', 'Granada', 'Ujarraz', 'Adcerrí', 'Pacaca', 'Barba']
    for loc in known_locs:
        if loc in text and loc not in locations:
            locations.append(loc)

    return {
        "people": people,
        "locations": locations,
        "event_summary": text[:250] + "..." if len(text) > 250 else text
    }

def process_file():
    events = []
    current_year = "Unknown"
    current_date = "Unknown"
    current_entry = ""
    
    print(f"Reading {INPUT_FILE}...")
    try:
        with open(INPUT_FILE, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except Exception as e:
        print(f"Error reading file: {e}")
        return

    print("Extracting entries...")
    # Parse the text into distinct entries based on the date markers
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        # Check for Year marker (e.g., "Año 1607")
        yr_match = year_pattern.match(line)
        if yr_match:
            current_year = yr_match.group(1)
            continue
            
        # Ignore structural lines (Headers, page numbers)
        if line.startswith("ARCHIVOS") or line.startswith("PROTOCOLOS") or line.isdigit() or line.startswith("Folio"):
            continue

        # Check for Date marker starting an entry
        date_match = date_pattern.match(line)
        if date_match:
            # We found a new entry, save the previous one if it exists
            if current_entry:
                entities = extract_entities(current_entry)
                events.append({
                    "id": len(events) + 1,
                    "year": current_year,
                    "date": current_date,
                    "people": entities["people"],
                    "locations": entities["locations"],
                    "description": entities["event_summary"],
                    "full_text": current_entry
                })
            
            month = date_match.group(1)
            day = date_match.group(2)
            rest_of_line = date_match.group(3)
            current_date = f"{month} {day}"
            current_entry = rest_of_line + " "
        else:
            # It's a continuation of the current entry
            if current_entry:
                current_entry += line + " "

    # Save the last entry
    if current_entry:
        entities = extract_entities(current_entry)
        events.append({
            "id": len(events) + 1,
            "year": current_year,
            "date": current_date,
            "people": entities["people"],
            "locations": entities["locations"],
            "description": entities["event_summary"],
            "full_text": current_entry
        })

    print(f"Extracted {len(events)} events.")
    
    # Save raw extracted events
    raw_output = os.path.join(OUTPUT_DIR, "raw_extracted_events.json")
    with open(raw_output, 'w', encoding='utf-8') as f:
        json.dump(events, f, ensure_ascii=False, indent=2)
    print(f"Saved raw events to {raw_output}")
    
    return events

if __name__ == "__main__":
    process_file()
