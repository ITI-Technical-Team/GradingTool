#!/usr/bin/env python3
import os
import sys
import json
import csv
import re
import argparse
import math

def school_round(n):
    """Performs standard mathematical rounding (half-up)."""
    if n - math.floor(n) < 0.5:
        return math.floor(n)
    return math.ceil(n)

def extract_problem_name(filepath):
    """Extracts the problem name from standard ITI_<problem>_sheet.json/csv filenames."""
    filename = os.path.basename(filepath)
    match = re.match(r"^ITI_(.+)_sheet\.(csv|json)$", filename)
    if match:
        return match.group(1)
    return os.path.splitext(filename)[0]

def load_sheet(filepath):
    """
    Loads a sheet from either a CSV or JSON file.
    Returns a dict: {github_username: {"name": str, "grade": int}}
    """
    data = {}
    if not os.path.exists(filepath):
        print(f"Error: Sheet file not found at {filepath}")
        return None
        
    if filepath.endswith('.json'):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                records = json.load(f)
                for rec in records:
                    username = rec.get("github_username")
                    if username:
                        # Extract grade, defaulting to 0 if not present or None
                        grade = rec.get("grade")
                        try:
                            grade = int(grade) if grade is not None else 0
                        except ValueError:
                            grade = 0
                        data[username] = {
                            "name": rec.get("name"),
                            "grade": grade
                        }
        except Exception as e:
            print(f"Error reading JSON file {filepath}: {e}")
            return None
    elif filepath.endswith('.csv'):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    username = row.get("github_username")
                    if username:
                        grade = row.get("grade")
                        try:
                            grade = int(grade) if grade is not None and grade.strip() != "" else 0
                        except ValueError:
                            grade = 0
                        data[username] = {
                            "name": row.get("name"),
                            "grade": grade
                        }
        except Exception as e:
            print(f"Error reading CSV file {filepath}: {e}")
            return None
    else:
        print(f"Unsupported file format: {filepath}. Use .csv or .json files.")
        return None
        
    return data

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

def main():
    parser = argparse.ArgumentParser(description="Merge multiple graded problem sheets into a daily summary.")
    parser.add_argument("input_sheets", nargs="+", help="Paths to problem JSON or CSV sheets to merge.")
    parser.add_argument("--roster", help="Path to student roster (CSV/TXT) to include students who did not submit anything.")
    parser.add_argument("--output-prefix", default="ITI_day_sheet", help="Prefix for output files (e.g. ITI_day_sheet).")
    parser.add_argument("--output-dir", help="Directory to save output files. Defaults to current directory.")
    
    args = parser.parse_args()
    
    if not args.input_sheets:
        print("Error: Please provide at least one input sheet to merge.")
        sys.exit(1)
        
    # Read sheets
    sheets = {} # problem_name -> {username: {name, grade}}
    problem_names = []
    
    for filepath in args.input_sheets:
        prob_name = extract_problem_name(filepath)
        sheet_data = load_sheet(filepath)
        if sheet_data is not None:
            sheets[prob_name] = sheet_data
            problem_names.append(prob_name)
            
    if not sheets:
        print("Error: No valid sheets were loaded.")
        sys.exit(1)
        
    print(f"Merging {len(sheets)} problem sheets: {', '.join(problem_names)}")
    
    # Load optional roster
    roster = load_roster(args.roster)
    
    # Get distinct union of all usernames
    all_usernames = set()
    for sheet_data in sheets.values():
        all_usernames.update(sheet_data.keys())
    if roster:
        all_usernames.update(roster.keys())
        
    # Merge and calculate final degrees
    output_records = []
    for username in sorted(all_usernames):
        record = {
            "github_username": username,
            "name": roster.get(username) if roster else None
        }
        
        grades = []
        # Populate grades for each problem
        for prob in problem_names:
            prob_data = sheets[prob].get(username)
            if prob_data:
                grade = prob_data["grade"]
                # Resolve real name if not set yet
                if not record["name"] and prob_data["name"]:
                    record["name"] = prob_data["name"]
            else:
                grade = 0
            
            record[prob] = grade
            grades.append(grade)
            
        # Calculate daily degree: round(sum(grades) / n)
        n = len(problem_names)
        total_degree = school_round(sum(grades) / n) if n > 0 else 0
        record["total_degree"] = total_degree
        
        output_records.append(record)
        
    # Output setup
    out_dir = args.output_dir if args.output_dir else os.getcwd()
    os.makedirs(out_dir, exist_ok=True)
    
    csv_filename = os.path.join(out_dir, f"{args.output_prefix}.csv")
    json_filename = os.path.join(out_dir, f"{args.output_prefix}.json")
    
    # Write CSV
    fieldnames = ["github_username", "name"] + problem_names + ["total_degree"]
    try:
        with open(csv_filename, "w", newline="", encoding="utf-8") as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            for rec in output_records:
                row = {k: ("" if v is None else v) for k, v in rec.items()}
                writer.writerow(row)
        print(f"Merged CSV saved to: {csv_filename}")
    except Exception as e:
        print(f"Error writing merged CSV: {e}")
        
    # Write JSON
    try:
        with open(json_filename, "w", encoding="utf-8") as jsonfile:
            json.dump(output_records, jsonfile, indent=2, ensure_ascii=False)
        print(f"Merged JSON saved to: {json_filename}")
    except Exception as e:
        print(f"Error writing merged JSON: {e}")

if __name__ == "__main__":
    main()
