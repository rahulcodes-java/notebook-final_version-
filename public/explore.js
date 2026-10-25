let allNotes = [];

document.addEventListener("DOMContentLoaded", () => {
    initExplore();
});

async function initExplore() {
    const searchInput = document.getElementById("search-input");
    const subjectFilter = document.getElementById("subject-filter");

    // Add event listeners
    if (searchInput) searchInput.addEventListener("input", filterNotes);
    if (subjectFilter) subjectFilter.addEventListener("change", filterNotes);

    try {
        const response = await fetch("/files/public");
        if (!response.ok) {
            throw new Error("Failed to fetch public notes");
        }
        allNotes = await response.json();
        
        // Sort notes by date descending initially
        allNotes.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
        
        // Populate subject dropdown
        populateSubjects(allNotes);
        
        // Render initial view
        renderNotes(allNotes);

    } catch (error) {
        console.error("Error loading explore notes:", error);
        const container = document.getElementById("notes-grid");
        if (container) {
            container.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; color: var(--error); padding: 3rem;">
                    Failed to load community notes. Please check back later.
                </div>
            `;
        }
    }
}

function populateSubjects(notes) {
    const dropdown = document.getElementById("subject-filter");
    if (!dropdown) return;

    const subjects = new Set(notes.map(n => n.folder).filter(Boolean));
    
    // Sort subjects alphabetically
    const sortedSubjects = Array.from(subjects).sort();

    sortedSubjects.forEach(subject => {
        const opt = document.createElement("option");
        opt.value = subject;
        opt.textContent = subject;
        dropdown.appendChild(opt);
    });
}

function filterNotes() {
    const query = document.getElementById("search-input").value.toLowerCase().trim();
    const selectedSubject = document.getElementById("subject-filter").value;

    const filtered = allNotes.filter(note => {
        const matchesSearch = 
            note.filename.toLowerCase().includes(query) || 
            (note.folder && note.folder.toLowerCase().includes(query)) ||
            (note.uploadedBy && note.uploadedBy.toLowerCase().includes(query));

        const matchesSubject = !selectedSubject || note.folder === selectedSubject;

        return matchesSearch && matchesSubject;
    });

    renderNotes(filtered);
}

function renderNotes(notes) {
    const container = document.getElementById("notes-grid");
    if (!container) return;

    if (!notes || notes.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 3rem;">
                No notes found matching your search.
            </div>
        `;
        return;
    }

    container.innerHTML = notes.map(file => {
        const dateStr = file.uploadedAt 
            ? new Date(file.uploadedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            : 'Unknown Date';
            
        const cleanName = file.filename.replace(/\.(pdf|txt|docx)$/i, "");
        const ext = file.filename.split('.').pop().toUpperCase();
        const downloadLabel = `Download ${ext}`;

        return `
            <div class="note-card">
                <div class="note-title" title="${file.filename}">${cleanName}</div>
                <div class="note-meta">
                    <span class="badge badge-subject">${file.folder || 'General'}</span>
                    <span class="badge badge-uploader">By: ${file.uploadedBy || 'anonymous'}</span>
                </div>
                <div class="note-date">Shared on ${dateStr}</div>
                <div class="note-actions">
                    <a href="/files/download?key=${encodeURIComponent(file.s3Key)}" class="btn-download" target="_blank">${downloadLabel}</a>
                </div>
            </div>
        `;
    }).join("");
}
