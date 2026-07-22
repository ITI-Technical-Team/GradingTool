// State Variables
let rawProblemData = null; // Raw parsed JSON from grade file
let selectedSlug = "";
let studentRoster = null; // Roster from grade tab
let rosterFileName = "";
let gradedResults = []; // Currently graded and filtered results
let sortDirection = {}; // Column sort states

let mergeRoster = null; // Roster from merge tab
let mergeRosterFileName = "";
let uploadedMergeSheets = {}; // filename -> { problemName, records: [ { github_username, name, grade } ] }
let mergedResults = []; // Currently merged results
let mergeProblemNames = []; // Column names for problems

const monthNames = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
};

// Initialize
document.addEventListener("DOMContentLoaded", () => {
    // Setup file dropzones
    setupDropzone("grade-dropzone", "grade-file-input", handleGradeFile);
    setupDropzone("merge-dropzone", "merge-file-input", handleMergeFiles);
    
    // Add real-time clock update (Cairo time helper)
    updateSystemTime();
    setInterval(updateSystemTime, 60000);
});

// System Time Helper
function updateSystemTime() {
    const timeEl = document.getElementById("system-time");
    const now = new Date();
    // Format UTC+3 (Cairo Summer Time) or similar
    const options = { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: true };
    const timeStr = now.toLocaleTimeString('en-US', options);
    timeEl.innerText = `Cairo Time: ${timeStr}`;
}

// Switch navigation tabs
window.switchTab = function(tabId) {
    document.querySelectorAll(".nav-tab").forEach(tab => tab.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.remove("active"));
    
    const activeTab = document.getElementById(`tab-btn-${tabId}`);
    const activePanel = document.getElementById(`tab-content-${tabId}`);
    
    if (activeTab) activeTab.classList.add("active");
    if (activePanel) activePanel.classList.add("active");
};

// Setup Dropzones
function setupDropzone(zoneId, inputId, handler) {
    const dropzone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    
    dropzone.addEventListener("click", () => input.click());
    
    dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
    });
    
    dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("dragover");
    });
    
    dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) {
            input.files = e.dataTransfer.files;
            handler(e.dataTransfer.files);
        }
    });
    
    input.addEventListener("change", () => {
        if (input.files.length > 0) {
            handler(input.files);
        }
    });
}

// ----------------------------------------------------
// TAB 1: GRADING LOGIC
// ----------------------------------------------------

function handleGradeFile(files) {
    const file = files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (typeof data !== 'object') {
                alert("Invalid JSON structure. Root must be a dictionary.");
                return;
            }
            
            rawProblemData = data;
            
            // Update UI
            document.getElementById("grade-file-info").classList.remove("hidden");
            document.getElementById("grade-uploaded-filename").innerText = file.name;
            document.getElementById("grade-dropzone").classList.add("hidden");
            
            // Populate Slugs Dropdown
            const select = document.getElementById("grade-slug-select");
            select.innerHTML = "";
            
            const slugs = Object.keys(data);
            slugs.forEach(slug => {
                const opt = document.createElement("option");
                opt.value = slug;
                opt.innerText = slug;
                select.appendChild(opt);
            });
            
            if (slugs.length > 0) {
                selectedSlug = slugs[0];
                recalculateGrade();
            }
        } catch (err) {
            alert("Error parsing JSON: " + err.message);
        }
    };
    reader.readAsText(file);
}

window.clearGradeFile = function() {
    rawProblemData = null;
    selectedSlug = "";
    gradedResults = [];
    activeGradeFilter = null;
    document.getElementById("grade-file-input").value = "";
    document.getElementById("grade-file-info").classList.add("hidden");
    document.getElementById("grade-dropzone").classList.remove("hidden");
    document.getElementById("grade-slug-select").innerHTML = '<option value="">No file loaded</option>';
    document.getElementById("grade-stats-grid").classList.add("hidden");
    document.getElementById("grade-chart-card").classList.add("hidden");
    document.getElementById("btn-export-csv-grade").disabled = true;
    document.getElementById("btn-export-json-grade").disabled = true;
    
    // Clear Table
    const tbody = document.querySelector("#graded-table tbody");
    tbody.innerHTML = `
        <tr class="empty-row">
            <td colspan="7">No submissions processed yet. Please upload a JSON file to get started.</td>
        </tr>
    `;
};

window.onGradeSlugChange = function() {
    selectedSlug = document.getElementById("grade-slug-select").value;
    recalculateGrade();
};

// Date Parsing Helper
function parseSubmissionTimestamp(tsStr) {
    if (!tsStr) return null;
    tsStr = tsStr.trim();
    // Wed, 22 Jul 2026 02:22:20PM EEST
    const match = tsStr.match(/^(\w+),\s+(\d+)\s+(\w+)\s+(\d+)\s+(\d+):(\d+):(\d+)(AM|PM)\s+(\w+)$/);
    if (match) {
        const [_, dayOfWeek, day, monthName, year, hourStr, minute, second, amPm, tz] = match;
        let hour = parseInt(hourStr);
        if (amPm === 'PM' && hour < 12) hour += 12;
        if (amPm === 'AM' && hour === 12) hour = 0;
        
        return new Date(parseInt(year), monthNames[monthName], parseInt(day), hour, parseInt(minute), parseInt(second));
    }
    
    const parsed = Date.parse(tsStr);
    if (!isNaN(parsed)) {
        return new Date(parsed);
    }
    return null;
}

window.recalculateGrade = function() {
    if (!rawProblemData || !selectedSlug) return;
    
    const submissions = rawProblemData[selectedSlug] || [];
    const deadlineVal = document.getElementById("grade-deadline").value;
    let deadlineDate = null;
    if (deadlineVal) {
        deadlineDate = new Date(deadlineVal);
    }
    
    // Group and find best submissions
    const grouped = {};
    submissions.forEach(sub => {
        const username = sub.github_username;
        if (!username) return;
        
        const subTime = parseSubmissionTimestamp(sub.timestamp);
        if (deadlineDate && subTime && subTime > deadlineDate) {
            return; // Skip submission after deadline
        }
        
        sub._parsed_time = subTime;
        
        if (!grouped[username]) {
            grouped[username] = [];
        }
        grouped[username].push(sub);
    });
    
    const graded = {};
    Object.keys(grouped).forEach(username => {
        const subs = grouped[username];
        // Sort: checks_passed desc, time desc
        subs.sort((a, b) => {
            const cpA = a.checks_passed || 0;
            const cpB = b.checks_passed || 0;
            if (cpA !== cpB) return cpB - cpA;
            
            const ptA = a._parsed_time ? a._parsed_time.getTime() : 0;
            const ptB = b._parsed_time ? b._parsed_time.getTime() : 0;
            return ptB - ptA;
        });
        graded[username] = subs[0];
    });
    
    // Build Output List
    gradedResults = [];
    const allUsernames = new Set();
    submissions.forEach(sub => {
        if (sub.github_username) {
            allUsernames.add(sub.github_username);
        }
    });
    if (studentRoster) {
        Object.keys(studentRoster).forEach(u => allUsernames.add(u));
    }
    
    let totalGradeSum = 0;
    let submittedCount = 0;
    
    const sortedUsernames = Array.from(allUsernames).sort();
    sortedUsernames.forEach(username => {
        const record = {
            github_username: username,
            name: studentRoster ? studentRoster[username] : null,
            checks_passed: 0,
            checks_run: 0,
            grade: 0,
            style50_score: null,
            timestamp: "No submission",
            github_url: null
        };
        
        if (graded[username]) {
            const sub = graded[username];
            const checks_passed = sub.checks_passed || 0;
            const checks_run = sub.checks_run || 0;
            let grade = 0;
            if (checks_run > 0) {
                grade = Math.round((checks_passed / checks_run) * 5);
            }
            
            record.name = sub.name || record.name;
            record.checks_passed = checks_passed;
            record.checks_run = checks_run;
            record.grade = grade;
            record.style50_score = sub.style50_score !== undefined ? sub.style50_score : null;
            record.timestamp = sub.timestamp;
            record.github_url = sub.github_url;
            
            totalGradeSum += grade;
            submittedCount++;
        }
        
        gradedResults.push(record);
    });
    
    // Update Stats Summary
    const totalCount = gradedResults.length;
    const noSubmitCount = totalCount - submittedCount;
    const avgGrade = submittedCount > 0 ? (totalGradeSum / submittedCount).toFixed(1) : "0.0";
    
    document.getElementById("stat-total-students").innerText = totalCount;
    document.getElementById("stat-submitted").innerText = submittedCount;
    document.getElementById("stat-no-submit").innerText = noSubmitCount;
    document.getElementById("stat-average-grade").innerText = avgGrade;
    document.getElementById("grade-stats-grid").classList.remove("hidden");
    
    const probName = selectedSlug.split("/").pop() || "problem";
    document.getElementById("graded-title").innerText = `Graded: ${probName}`;
    document.getElementById("graded-stats-summary").innerText = `${submittedCount}/${totalCount} students submitted before deadline.`;
    
    // Enable Exports
    document.getElementById("btn-export-csv-grade").disabled = false;
    document.getElementById("btn-export-json-grade").disabled = false;
    
    renderGradeTable();
    updateDistributionChart(gradedResults);
};

let activeGradeFilter = null;

function renderGradeTable() {
    const tbody = document.querySelector("#graded-table tbody");
    tbody.innerHTML = "";
    
    let displayResults = gradedResults;
    if (activeGradeFilter !== null) {
        displayResults = gradedResults.filter(r => {
            const g = r.timestamp === "No submission" ? 0 : r.grade;
            return g === activeGradeFilter;
        });
    }
    
    if (displayResults.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="7">No results match the current filters.</td>
            </tr>
        `;
        return;
    }
    
    displayResults.forEach(rec => {
        const tr = document.createElement("tr");
        if (rec.timestamp === "No submission") {
            tr.className = "row-absent";
        }
        
        // Github username cell
        const tdUser = document.createElement("td");
        tdUser.className = "github-username-cell";
        tdUser.innerText = rec.github_username;
        tr.appendChild(tdUser);
        
        // Real name cell
        const tdName = document.createElement("td");
        tdName.className = "real-name-cell";
        if (rec.name) {
            tdName.innerText = rec.name;
        } else {
            const span = document.createElement("span");
            span.className = "dimmed-dash";
            span.innerText = "—";
            tdName.appendChild(span);
        }
        tr.appendChild(tdName);
        
        // Checks passed
        const tdPassed = document.createElement("td");
        tdPassed.innerText = rec.timestamp !== "No submission" ? rec.checks_passed : "-";
        tr.appendChild(tdPassed);
        
        // Checks run
        const tdRun = document.createElement("td");
        tdRun.innerText = rec.timestamp !== "No submission" ? rec.checks_run : "-";
        tr.appendChild(tdRun);
        
        // Grade badge
        const tdGrade = document.createElement("td");
        const badge = document.createElement("span");
        if (rec.timestamp !== "No submission") {
            badge.className = `grade-badge grade-${rec.grade}`;
            badge.innerText = rec.grade;
        } else {
            badge.className = "grade-badge grade-0";
            badge.innerText = "0";
        }
        tdGrade.appendChild(badge);
        tr.appendChild(tdGrade);
        
        // Style score
        const tdStyle = document.createElement("td");
        tdStyle.innerText = (rec.style50_score !== null && rec.style50_score !== undefined) 
            ? (rec.style50_score * 100).toFixed(0) + "%" 
            : "-";
        tr.appendChild(tdStyle);
        
        // Date timestamp / Link
        const tdTime = document.createElement("td");
        if (rec.github_url) {
            const link = document.createElement("a");
            link.href = rec.github_url;
            link.target = "_blank";
            link.className = "github-url-link";
            link.innerHTML = `${rec.timestamp} <span class="ext-link-icon">↗</span>`;
            tdTime.appendChild(link);
        } else {
            tdTime.innerText = rec.timestamp;
            if (rec.timestamp === "No submission") {
                tdTime.className = "text-warning";
            }
        }
        tr.appendChild(tdTime);
        
        tbody.appendChild(tr);
    });
}

window.filterGradeTable = function() {
    const query = document.getElementById("grade-search").value.toLowerCase();
    const clearBtn = document.getElementById("grade-search-clear");
    if (query) {
        clearBtn.classList.remove("hidden");
    } else {
        clearBtn.classList.add("hidden");
    }
    
    const rows = document.querySelectorAll("#graded-table tbody tr");
    rows.forEach(row => {
        if (row.classList.contains("empty-row")) return;
        const text = row.innerText.toLowerCase();
        if (text.includes(query)) {
            row.classList.remove("hidden");
        } else {
            row.classList.add("hidden");
        }
    });
};

window.clearSearch = function(tab) {
    const input = document.getElementById(`${tab}-search`);
    input.value = "";
    if (tab === 'grade') {
        const clearBtn = document.getElementById("grade-search-clear");
        clearBtn.classList.add("hidden");
        filterGradeTable();
    } else {
        const clearBtn = document.getElementById("merge-search-clear");
        clearBtn.classList.add("hidden");
        filterMergeTable();
    }
};

function updateDistributionChart(records) {
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, 0: 0 };
    let maxCount = 0;
    
    records.forEach(rec => {
        const grade = rec.timestamp === "No submission" ? 0 : (rec.grade || 0);
        counts[grade] = (counts[grade] || 0) + 1;
    });
    
    Object.values(counts).forEach(val => {
        if (val > maxCount) maxCount = val;
    });
    
    const chartCard = document.getElementById("grade-chart-card");
    const barsContainer = document.getElementById("grade-chart-bars");
    
    if (records.length === 0) {
        chartCard.classList.add("hidden");
        return;
    }
    
    chartCard.classList.remove("hidden");
    barsContainer.innerHTML = "";
    
    [0, 1, 2, 3, 4, 5].forEach(grade => {
        const count = counts[grade] || 0;
        const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;
        
        const wrapper = document.createElement("div");
        wrapper.className = "chart-bar-wrapper";
        if (activeGradeFilter === grade) {
            wrapper.classList.add("active");
        }
        
        const barContainer = document.createElement("div");
        barContainer.className = "chart-bar-container";
        
        const bar = document.createElement("div");
        bar.className = `chart-bar grade-bar-${grade}`;
        bar.style.height = `${percentage}%`;
        bar.onclick = () => filterTableByGrade(grade);
        
        if (count > 0) {
            const valSpan = document.createElement("span");
            valSpan.className = "chart-bar-value";
            valSpan.innerText = count;
            bar.appendChild(valSpan);
        }
        
        barContainer.appendChild(bar);
        
        const labelSpan = document.createElement("span");
        labelSpan.className = "chart-bar-label";
        labelSpan.innerText = `G${grade}`;
        
        wrapper.appendChild(barContainer);
        wrapper.appendChild(labelSpan);
        barsContainer.appendChild(wrapper);
    });
    
    const clearBtn = document.getElementById("btn-clear-grade-filter");
    if (activeGradeFilter !== null) {
        clearBtn.classList.remove("hidden");
    } else {
        clearBtn.classList.add("hidden");
    }
}

window.filterTableByGrade = function(grade) {
    if (activeGradeFilter === grade) {
        activeGradeFilter = null;
    } else {
        activeGradeFilter = grade;
    }
    renderGradeTable();
    updateDistributionChart(gradedResults);
};

window.clearGradeFilter = function() {
    activeGradeFilter = null;
    renderGradeTable();
    updateDistributionChart(gradedResults);
};

window.sortGradeTable = function(columnKey) {
    // Determine sort direction
    const currentDir = sortDirection[columnKey] || 'asc';
    const nextDir = currentDir === 'asc' ? 'desc' : 'asc';
    sortDirection[columnKey] = nextDir;
    
    // Update headers indicators
    const headers = document.querySelectorAll("#graded-table th");
    headers.forEach(h => {
        h.classList.remove("sort-asc", "sort-desc");
    });
    
    // Find header
    const colIdx = {
        'github_username': 0, 'name': 1, 'checks_passed': 2,
        'checks_run': 3, 'grade': 4, 'style50_score': 5, 'timestamp': 6
    }[columnKey];
    headers[colIdx].classList.add(nextDir === 'asc' ? 'sort-asc' : 'sort-desc');
    
    // Sort logic
    gradedResults.sort((a, b) => {
        let valA = a[columnKey];
        let valB = b[columnKey];
        
        // Handle Null values in sorting
        if (valA === null || valA === undefined || valA === "No submission") valA = nextDir === 'asc' ? Infinity : -Infinity;
        if (valB === null || valB === undefined || valB === "No submission") valB = nextDir === 'asc' ? Infinity : -Infinity;
        
        if (typeof valA === 'string' && typeof valB === 'string') {
            return nextDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else {
            return nextDir === 'asc' ? (valA - valB) : (valB - valA);
        }
    });
    
    renderGradeTable();
};

// Roster upload files parsing
window.loadRosterFile = function(input, tab) {
    const file = input.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const roster = {};
        
        if (file.name.endsWith('.csv')) {
            const lines = text.split('\n');
            let usernameIdx = 0;
            let nameIdx = -1;
            
            if (lines.length > 0) {
                const header = lines[0].split(',');
                header.forEach((col, idx) => {
                    const colLower = col.toLowerCase().trim();
                    if (colLower.includes('username') || colLower.includes('github')) {
                        usernameIdx = idx;
                    } else if (colLower.includes('name')) {
                        nameIdx = idx;
                    }
                });
                
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    const cols = line.split(',');
                    if (cols.length > usernameIdx) {
                        const uname = cols[usernameIdx].trim();
                        const name = nameIdx !== -1 && cols.length > nameIdx ? cols[nameIdx].trim() : null;
                        if (uname) roster[uname] = name;
                    }
                }
            }
        } else {
            // TXT file, one username per line, optionally with a comma and name
            const lines = text.split('\n');
            lines.forEach(line => {
                line = line.trim();
                if (!line || line.startsWith('#')) return;
                const parts = line.split(',');
                if (parts.length >= 2) {
                    roster[parts[0].trim()] = parts[1].trim();
                } else if (parts.length === 1) {
                    roster[parts[0].trim()] = null;
                }
            });
        }
        
        if (tab === 'grade') {
            studentRoster = roster;
            rosterFileName = file.name;
            document.getElementById("grade-roster-status").innerText = `✅ Roster: ${file.name}`;
            recalculateGrade();
        } else {
            mergeRoster = roster;
            mergeRosterFileName = file.name;
            document.getElementById("merge-roster-status").innerText = `✅ Roster: ${file.name}`;
            recalculateMerge();
        }
    };
    reader.readAsText(file);
};

// Export Functionality
window.exportGraded = function(format) {
    if (gradedResults.length === 0) return;
    
    const probName = selectedSlug.split("/").pop() || "problem";
    const filename = `ITI_${probName}_sheet.${format}`;
    let content = "";
    let mimeType = "";
    
    if (format === 'json') {
        content = JSON.stringify(gradedResults, null, 2);
        mimeType = "application/json";
    } else {
        // CSV
        const headers = ["github_username", "name", "checks_passed", "checks_run", "grade", "style50_score", "timestamp", "github_url"];
        const rows = [headers.join(",")];
        
        gradedResults.forEach(rec => {
            const line = headers.map(key => {
                let val = rec[key];
                if (val === null || val === undefined) val = "";
                // Escape quotes
                val = String(val).replace(/"/g, '""');
                // Wrap in quotes if needed
                if (val.includes(",") || val.includes("\n") || val.includes('"')) {
                    val = `"${val}"`;
                }
                return val;
            });
            rows.push(line.join(","));
        });
        content = rows.join("\n");
        mimeType = "text/csv";
    }
    
    triggerDownload(content, filename, mimeType);
};

function triggerDownload(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ----------------------------------------------------
// TAB 2: MERGING LOGIC
// ----------------------------------------------------

function handleMergeFiles(files) {
    let loadedCount = 0;
    
    Array.from(files).forEach(file => {
        if (!file.name.endsWith('.json')) {
            alert(`File ${file.name} is not a JSON file. Skipped.`);
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const records = JSON.parse(e.target.result);
                if (!Array.isArray(records)) {
                    alert(`Invalid structure in ${file.name}. Must be a JSON array of graded records.`);
                    return;
                }
                
                // Extract problem name
                let probName = file.name;
                const match = file.name.match(/^ITI_(.+)_sheet\.json$/);
                if (match) {
                    probName = match[1];
                } else {
                    probName = file.name.replace(".json", "");
                }
                
                uploadedMergeSheets[file.name] = {
                    problemName: probName,
                    records: records
                };
                
                loadedCount++;
                if (loadedCount === files.length) {
                    renderMergeFileList();
                    recalculateMerge();
                }
            } catch (err) {
                alert(`Error parsing JSON file ${file.name}: ` + err.message);
            }
        };
        reader.readAsText(file);
    });
}

function renderMergeFileList() {
    const container = document.getElementById("merge-file-list");
    container.innerHTML = "";
    
    const fileKeys = Object.keys(uploadedMergeSheets);
    if (fileKeys.length === 0) {
        container.innerHTML = '<div class="empty-list-prompt">No files added yet</div>';
        return;
    }
    
    fileKeys.forEach(key => {
        const item = document.createElement("div");
        item.className = "merge-file-item";
        
        const nameSpan = document.createElement("span");
        nameSpan.innerText = `📄 ${uploadedMergeSheets[key].problemName} (${key})`;
        item.appendChild(nameSpan);
        
        const delBtn = document.createElement("button");
        delBtn.className = "btn-file-delete";
        delBtn.innerText = "✕";
        delBtn.onclick = (e) => {
            e.stopPropagation();
            delete uploadedMergeSheets[key];
            renderMergeFileList();
            recalculateMerge();
        };
        item.appendChild(delBtn);
        
        container.appendChild(item);
    });
}

function recalculateMerge() {
    const fileKeys = Object.keys(uploadedMergeSheets);
    if (fileKeys.length === 0) {
        document.getElementById("btn-export-csv-merge").disabled = true;
        document.getElementById("btn-export-json-merge").disabled = true;
        document.getElementById("merged-stats-summary").innerText = "Upload graded JSON sheets to merge.";
        
        // Reset table headers & body
        document.getElementById("merged-table-header").innerHTML = `
            <th>GitHub Username</th>
            <th>Student Name</th>
            <th>Total Degree (Avg)</th>
        `;
        document.querySelector("#merged-table tbody").innerHTML = `
            <tr class="empty-row">
                <td colspan="3">No graded sheets loaded yet. Add at least two graded JSON files to compute daily degrees.</td>
            </tr>
        `;
        return;
    }
    
    mergeProblemNames = fileKeys.map(k => uploadedMergeSheets[k].problemName);
    
    // Find union of usernames
    const allUsernames = new Set();
    fileKeys.forEach(k => {
        uploadedMergeSheets[k].records.forEach(rec => {
            if (rec.github_username) {
                allUsernames.add(rec.github_username);
            }
        });
    });
    
    if (mergeRoster) {
        Object.keys(mergeRoster).forEach(u => allUsernames.add(u));
    }
    
    // Merge grades
    mergedResults = [];
    const sortedUsernames = Array.from(allUsernames).sort();
    
    sortedUsernames.forEach(username => {
        const record = {
            github_username: username,
            name: mergeRoster ? mergeRoster[username] : null
        };
        
        let sumGrades = 0;
        
        fileKeys.forEach(k => {
            const sheet = uploadedMergeSheets[k];
            const studentRec = sheet.records.find(r => r.github_username === username);
            const grade = studentRec ? (studentRec.grade || 0) : 0;
            
            record[sheet.problemName] = grade;
            sumGrades += grade;
            
            if (!record.name && studentRec && studentRec.name) {
                record.name = studentRec.name;
            }
        });
        
        const n = fileKeys.length;
        const total_degree = n > 0 ? Math.round(sumGrades / n) : 0;
        record.total_degree = total_degree;
        
        mergedResults.push(record);
    });
    
    // Update Stats text
    document.getElementById("merged-stats-summary").innerText = `Merged ${fileKeys.length} tasks for ${mergedResults.length} distinct students.`;
    
    // Enable Exports
    document.getElementById("btn-export-csv-merge").disabled = false;
    document.getElementById("btn-export-json-merge").disabled = false;
    
    renderMergeTable();
}

function renderMergeTable() {
    const headerRow = document.getElementById("merged-table-header");
    headerRow.innerHTML = "<th>GitHub Username</th><th>Student Name</th>";
    
    // Add columns for problems
    mergeProblemNames.forEach(probName => {
        const th = document.createElement("th");
        th.innerText = probName;
        headerRow.appendChild(th);
    });
    
    // Add final average degree column
    const thTotal = document.createElement("th");
    thTotal.innerText = "Total Degree (Avg)";
    headerRow.appendChild(thTotal);
    
    // Populate Body
    const tbody = document.querySelector("#merged-table tbody");
    tbody.innerHTML = "";
    
    if (mergedResults.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="${mergeProblemNames.length + 3}">No merge records computed.</td>
            </tr>
        `;
        return;
    }
    
    mergedResults.forEach(rec => {
        const tr = document.createElement("tr");
        
        // Username
        const tdUser = document.createElement("td");
        tdUser.className = "github-username-cell";
        tdUser.innerText = rec.github_username;
        tr.appendChild(tdUser);
        
        // Real Name
        const tdName = document.createElement("td");
        tdName.className = "real-name-cell";
        tdName.innerText = rec.name || "-";
        tr.appendChild(tdName);
        
        // Problem grades
        mergeProblemNames.forEach(probName => {
            const tdProb = document.createElement("td");
            const grade = rec[probName] || 0;
            const badge = document.createElement("span");
            badge.className = `grade-badge grade-${grade}`;
            badge.innerText = grade;
            tdProb.appendChild(badge);
            tr.appendChild(tdProb);
        });
        
        // Total average
        const tdTotal = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = `grade-badge grade-${rec.total_degree}`;
        badge.innerText = rec.total_degree;
        tdTotal.appendChild(badge);
        tr.appendChild(tdTotal);
        
        tbody.appendChild(tr);
    });
}

window.filterMergeTable = function() {
    const query = document.getElementById("merge-search").value.toLowerCase();
    const clearBtn = document.getElementById("merge-search-clear");
    if (query) {
        clearBtn.classList.remove("hidden");
    } else {
        clearBtn.classList.add("hidden");
    }
    
    const rows = document.querySelectorAll("#merged-table tbody tr");
    
    rows.forEach(row => {
        if (row.classList.contains("empty-row")) return;
        const text = row.innerText.toLowerCase();
        if (text.includes(query)) {
            row.classList.remove("hidden");
        } else {
            row.classList.add("hidden");
        }
    });
};

window.exportMerged = function(format) {
    if (mergedResults.length === 0) return;
    
    const filename = `ITI_merged_day_sheet.${format}`;
    let content = "";
    let mimeType = "";
    
    if (format === 'json') {
        content = JSON.stringify(mergedResults, null, 2);
        mimeType = "application/json";
    } else {
        // CSV
        const headers = ["github_username", "name"].concat(mergeProblemNames).concat(["total_degree"]);
        const rows = [headers.join(",")];
        
        mergedResults.forEach(rec => {
            const line = headers.map(key => {
                let val = rec[key];
                if (val === null || val === undefined) val = "";
                // Escape quotes
                val = String(val).replace(/"/g, '""');
                if (val.includes(",") || val.includes("\n") || val.includes('"')) {
                    val = `"${val}"`;
                }
                return val;
            });
            rows.push(line.join(","));
        });
        content = rows.join("\n");
        mimeType = "text/csv";
    }
    
    triggerDownload(content, filename, mimeType);
};
