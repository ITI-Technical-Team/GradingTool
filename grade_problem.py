#!/usr/bin/env python3
import os
import sys
import json
import csv
import re
import argparse
from datetime import datetime
import math

def school_round(n):
    """Performs standard mathematical rounding (half-up)."""
    if n - math.floor(n) < 0.5:
        return math.floor(n)
    return math.ceil(n)

def parse_timestamp(ts_str):
    """
    Parses timestamps like 'Wed, 22 Jul 2026 02:22:20PM EEST' 
    or common ISO formats, returning a naive datetime object.
    """
    if not ts_str:
        return None
    ts_str = ts_str.strip()
    
    # Try parsing "Day, DD Mon YYYY HH:MM:SS(AM/PM) TZ"
    match = re.match(r"^(\w+),\s+(\d+)\s+(\w+)\s+(\d+)\s+(\d+):(\d+):(\d+)(AM|PM)\s+(\w+)$", ts_str)
    if match:
        _, day, month, year, hour, minute, second, am_pm, _ = match.groups()
        dt_str = f"{day} {month} {year} {hour}:{minute}:{second} {am_pm}"
        try:
            return datetime.strptime(dt_str, "%d %b %Y %I:%M:%S %p")
        except ValueError:
            pass
            
    # Try ISO/standard formats
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%d/%m/%Y %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(ts_str, fmt)
        except ValueError:
            continue
            
    return None

def parse_deadline(deadline_str):
    """Parses user deadline input, defaulting to end of day if only date is provided."""
    if not deadline_str:
        return None
    
    dt = parse_timestamp(deadline_str)
    if dt:
        return dt
        
    # If date-only YYYY-MM-DD was provided but parsing failed, try it and set to end of day
    try:
        return datetime.strptime(deadline_str.strip(), "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    except ValueError:
        pass
        
    raise argparse.ArgumentTypeError(
        f"Could not parse deadline: '{deadline_str}'. "
        "Use YYYY-MM-DD, YYYY-MM-DD HH:MM:SS, or 'Wed, 22 Jul 2026 02:22:20PM EEST'"
    )

def load_roster(roster_path):
    """
    Loads GitHub usernames and optional real names from a CSV or TXT file.
    Returns a dict: {github_username: real_name}
    """
    if not roster_path:
        return None
    roster = {}
    if not os.path.exists(roster_path):
        print(f"Warning: Roster file not found at {roster_path}")
        return None
        
    with open(roster_path, mode='r', encoding='utf-8') as f:
        if roster_path.endswith('.csv'):
            reader = csv.reader(f)
            try:
                header = next(reader)
                username_idx = -1
                name_idx = -1
                for i, col in enumerate(header):
                    col_lower = col.lower().strip()
                    if 'username' in col_lower or 'github' in col_lower:
                        username_idx = i
                    elif 'name' in col_lower:
                        name_idx = i
                
                if username_idx == -1:
                    username_idx = 0
                
                for row in reader:
                    if not row or len(row) <= username_idx:
                        continue
                    uname = row[username_idx].strip()
                    name = row[name_idx].strip() if (name_idx != -1 and len(row) > name_idx) else None
                    if uname:
                        roster[uname] = name
            except StopIteration:
                pass
        else:
            # TXT file: each line is username, optional name after comma
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                parts = line.split(',', 1)
                if len(parts) == 2:
                    uname = parts[0].strip()
                    name = parts[1].strip()
                else:
                    uname = line
                    name = None
                if uname:
                    roster[uname] = name
    return roster

def process_submissions(submissions, deadline=None):
    """
    Processes submissions list, groups by student, filters by deadline,
    picks the best submission (max checks_passed, tie-break by latest timestamp).
    Returns a dict: {github_username: best_submission_dict}
    """
    grouped = {}
    for sub in submissions:
        username = sub.get("github_username")
        if not username:
            continue
            
        ts_str = sub.get("timestamp")
        sub_time = parse_timestamp(ts_str)
        
        # Apply deadline filter
        if deadline and sub_time:
            if sub_time > deadline:
                continue
                
        # Store datetime object for comparison
        sub["_parsed_time"] = sub_time
        
        if username not in grouped:
            grouped[username] = []
        grouped[username].append(sub)
        
    graded_students = {}
    for username, subs in grouped.items():
        # Tie breaking: Sort by checks_passed descending, then parsed_time descending (latest first)
        # Handle None in checks_passed/time
        def sort_key(s):
            cp = s.get("checks_passed") or 0
            pt = s.get("_parsed_time") or datetime.min
            return (cp, pt)
            
        best_sub = max(subs, key=sort_key)
        graded_students[username] = best_sub
        
    return graded_students

def main():
    parser = argparse.ArgumentParser(description="Grade problem submissions from raw JSON data.")
    parser.add_argument("input_json", help="Path to raw submissions JSON file.")
    parser.add_argument("--deadline", type=parse_deadline, help="Deadline timestamp (e.g. '2026-07-22 23:59:59' or full format).")
    parser.add_argument("--roster", help="Path to student roster (CSV/TXT) to include students who did not submit.")
    parser.add_argument("--output-dir", help="Directory to save output sheets. Defaults to the input file directory.")
    
    args = parser.parse_args()
    
    # Load JSON
    try:
        with open(args.input_json, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error loading JSON file: {e}")
        sys.exit(1)
        
    # If file contains an array or structured differently, normalize it.
    # Raw format is expected to be dict: { "slug": [submissions] }
    if not isinstance(data, dict):
        print("Error: Input JSON must be a dictionary mapping slugs to submission lists.")
        sys.exit(1)
        
    # Output directory setup
    out_dir = args.output_dir if args.output_dir else os.path.dirname(os.path.abspath(args.input_json))
    os.makedirs(out_dir, exist_ok=True)
    
    # Load optional roster
    roster = load_roster(args.roster)
    
    for slug, submissions in data.items():
        # Resolve clean problem name from slug
        prob_name = slug.split("/")[-1] if "/" in slug else slug
        if not prob_name:
            prob_name = "problem"
            
        print(f"Grading problem: {slug} (Name: {prob_name})")
        
        # Process and select best submissions
        graded = process_submissions(submissions, args.deadline)
        
        # Construct output list
        output_records = []
        
        # List of all usernames to output (union of all raw submissions and roster if available)
        all_usernames = set(sub.get("github_username") for sub in submissions if sub.get("github_username"))
        if roster:
            all_usernames.update(roster.keys())
            
        # Sort usernames for clean output
        for username in sorted(all_usernames):
            record = {
                "github_username": username,
                "name": roster.get(username) if roster else None,
                "checks_passed": 0,
                "checks_run": 0,
                "grade": 0,
                "style50_score": None,
                "timestamp": None,
                "github_url": None
            }
            
            if username in graded:
                sub = graded[username]
                checks_passed = sub.get("checks_passed") or 0
                checks_run = sub.get("checks_run") or 0
                
                # Calculate grade
                grade = 0
                if checks_run > 0:
                    grade = school_round((checks_passed / checks_run) * 5)
                    
                # Override roster name if JSON has a name
                real_name = sub.get("name") or (roster.get(username) if roster else None)
                
                record.update({
                    "name": real_name,
                    "checks_passed": checks_passed,
                    "checks_run": checks_run,
                    "grade": grade,
                    "style50_score": sub.get("style50_score"),
                    "timestamp": sub.get("timestamp"),
                    "github_url": sub.get("github_url")
                })
            else:
                # Student didn't submit
                record["timestamp"] = "No submission"
                
            output_records.append(record)
            
        # Write outputs
        csv_filename = os.path.join(out_dir, f"ITI_{prob_name}_sheet.csv")
        json_filename = os.path.join(out_dir, f"ITI_{prob_name}_sheet.json")
        
        # Write CSV
        fieldnames = ["github_username", "name", "checks_passed", "checks_run", "grade", "style50_score", "timestamp", "github_url"]
        try:
            with open(csv_filename, "w", newline="", encoding="utf-8") as csvfile:
                writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
                writer.writeheader()
                for rec in output_records:
                    # format None/null values gracefully for CSV
                    row = {k: ("" if v is None else v) for k, v in rec.items()}
                    writer.writerow(row)
            print(f"  -> Saved CSV: {csv_filename}")
        except Exception as e:
            print(f"Error writing CSV for {prob_name}: {e}")
            
        # Write JSON
        try:
            with open(json_filename, "w", encoding="utf-8") as jsonfile:
                json.dump(output_records, jsonfile, indent=2, ensure_ascii=False)
            print(f"  -> Saved JSON: {json_filename}")
        except Exception as e:
            print(f"Error writing JSON for {prob_name}: {e}")

if __name__ == "__main__":
    main()
