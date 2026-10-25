document.addEventListener("DOMContentLoaded", () => {
    initHome();
});

async function initHome() {
    // Nav bar setup
    setupNavbar();

    // Fetch and display data
    try {
        const response = await fetch("/files/public");
        if (!response.ok) {
            throw new Error("Failed to fetch public notes");
        }
        const files = await response.json();
        
        // Calculate statistics
        calculateStats(files);
        
        // Render Featured Notes
        renderFeaturedNotes(files);
        
        // Render Top Contributors
        renderTopContributors(files);

    } catch (error) {
        console.error("Error loading homepage data:", error);
        // Fallback placeholders if API fails
        calculateStats([]);
        renderFeaturedNotes([]);
        renderTopContributors([]);
    }
}

function setupNavbar() {
    const token = localStorage.getItem("token");
    const navGuest = document.getElementById("nav-guest");
    const navAuth = document.getElementById("nav-auth");
    const heroBtnJoin = document.getElementById("hero-btn-join");
    const heroBtnDashboard = document.getElementById("hero-btn-dashboard");

    if (token) {
        if (navGuest) navGuest.classList.add("nav-hidden");
        if (navAuth) navAuth.classList.remove("nav-hidden");
        if (heroBtnJoin) heroBtnJoin.style.display = "none";
        if (heroBtnDashboard) heroBtnDashboard.style.display = "inline-flex";
    } else {
        if (navGuest) navGuest.classList.remove("nav-hidden");
        if (navAuth) navAuth.classList.add("nav-hidden");
        if (heroBtnJoin) heroBtnJoin.style.display = "inline-flex";
        if (heroBtnDashboard) heroBtnDashboard.style.display = "none";
    }
}

function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("userId");
    window.location.href = "index.html";
}

function calculateStats(files) {
    const totalNotesEl = document.getElementById("total-notes");
    const totalContributorsEl = document.getElementById("total-contributors");
    const totalSubjectsEl = document.getElementById("total-subjects");
    const totalDownloadsEl = document.getElementById("total-downloads");

    if (!files || files.length === 0) {
        if (totalNotesEl) totalNotesEl.textContent = "0";
        if (totalContributorsEl) totalContributorsEl.textContent = "0";
        if (totalSubjectsEl) totalSubjectsEl.textContent = "0";
        if (totalDownloadsEl) totalDownloadsEl.textContent = "0";
        return;
    }

    // Total Notes
    if (totalNotesEl) totalNotesEl.textContent = files.length;

    // Contributors
    const contributors = new Set(files.map(f => f.uploadedBy).filter(Boolean));
    if (totalContributorsEl) totalContributorsEl.textContent = contributors.size;

    // Subjects
    const subjects = new Set(files.map(f => f.folder).filter(Boolean));
    if (totalSubjectsEl) totalSubjectsEl.textContent = subjects.size;

    // Simulated downloads (just as a nice community metric, let's say files.length * 7 + 12)
    if (totalDownloadsEl) totalDownloadsEl.textContent = files.length * 7 + 12;
}

function renderFeaturedNotes(files) {
    const container = document.getElementById("featured-notes-container");
    if (!container) return;

    if (!files || files.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 2rem;">
                No public notes have been shared yet. Be the first to contribute!
            </div>
        `;
        return;
    }

    // Sort by upload date descending and take top 3
    const featured = [...files]
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
        .slice(0, 3);

    container.innerHTML = featured.map(file => {
        const dateStr = file.uploadedAt 
            ? new Date(file.uploadedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            : 'Unknown Date';
            
        // Clean filename (strip extension)
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

function renderTopContributors(files) {
    const container = document.getElementById("top-contributors-container");
    if (!container) return;

    if (!files || files.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 2rem;">
                No contributors yet. Register and upload notes to be featured!
            </div>
        `;
        return;
    }

    // Count notes per contributor
    const counts = {};
    files.forEach(file => {
        const uploader = file.uploadedBy || 'anonymous';
        counts[uploader] = (counts[uploader] || 0) + 1;
    });

    // Convert to array and sort descending
    const contributors = Object.keys(counts).map(name => ({
        name,
        count: counts[name]
    })).sort((a, b) => b.count - a.count).slice(0, 4);

    container.innerHTML = contributors.map(c => {
        const firstLetter = c.name.charAt(0).toUpperCase();
        return `
            <div class="contributor-card">
                <div class="contributor-avatar">${firstLetter}</div>
                <div class="contributor-name">${c.name}</div>
                <div class="contributor-count">${c.count} ${c.count === 1 ? 'document' : 'documents'} shared</div>
            </div>
        `;
    }).join("");
}
