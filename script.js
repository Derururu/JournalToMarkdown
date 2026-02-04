document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const folderInput = document.getElementById('folderInput');
    const uploadSection = document.querySelector('.upload-section');
    const filterSection = document.getElementById('filterSection');
    const entriesFoundCount = document.getElementById('entriesFoundCount');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const filterStats = document.getElementById('filterStats');
    const convertBtn = document.getElementById('convertBtn');
    const statusOverlay = document.getElementById('statusOverlay');
    const statusTitle = document.getElementById('statusTitle');
    const statusMessage = document.getElementById('statusMessage');
    const progressFill = document.getElementById('progressFill');

    // State
    let fileMap = new Map(); // path -> File object
    let entries = []; // Array of { date: Date, title: string, path: string }
    let rootPath = '';

    // Initialize Turndown Service
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced'
    });

    // File Selection Handler
    folderInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        fileMap.clear();
        entries = [];
        
        // Find the index.html and root path
        let indexFile = null;
        
        for (const file of files) {
            // Normalize path separators
            const path = file.webkitRelativePath || file.name;
            fileMap.set(path, file);

            if (file.name === 'index.html' && path.split('/').length <= 2) {
                // Heuristic: index.html should be near root
                indexFile = file;
                rootPath = path.substring(0, path.lastIndexOf('/') + 1);
            }
        }

        if (!indexFile) {
            alert('Could not find index.html in the selected folder. Please make sure you selected the root of the export.');
            return;
        }

        // Parse Index
        showStatus('Analyzing Index', 'Reading journal entries...', 0);
        try {
            await parseIndexFile(indexFile);
            uploadSection.classList.add('hidden');
            filterSection.classList.remove('hidden');
            updateFilterStats();
        } catch (err) {
            console.error(err);
            alert('Error parsing index.html');
        } finally {
            hideStatus();
        }
    });

    // Date Input Handlers
    startDateInput.addEventListener('change', updateFilterStats);
    endDateInput.addEventListener('change', updateFilterStats);

    // Convert Button Handler
    convertBtn.addEventListener('click', startConversion);

    // Start Over Button Handler
    document.getElementById('startOverBtn').addEventListener('click', () => {
        // Reset State
        fileMap.clear();
        entries = [];
        rootPath = '';
        
        // Reset Inputs
        folderInput.value = '';
        startDateInput.value = '';
        endDateInput.value = '';
        filterStats.textContent = 'Select a date range to begin.';
        convertBtn.disabled = true;
        entriesFoundCount.textContent = 'Found 0 entries';

        // Toggle Views
        filterSection.classList.add('hidden');
        uploadSection.classList.remove('hidden');
    });

    // Helper: Parse index.html
    async function parseIndexFile(file) {
        const text = await readFileText(file);
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');
        
        // Based on user sample:
        // Entries are in <p class="p1"><span class="s1"><a href="Entries/...">Date — Title</a></span></p>
        const linkElements = doc.querySelectorAll('a[href]');
        
        entries = [];
        let minDate = new Date();
        let maxDate = new Date(0);

        linkElements.forEach(a => {
            const href = a.getAttribute('href');
            const textContent = a.textContent.trim();
            
            // Format: "4. Feb 2026 — Title" OR "15. Dec 2025" (no title)
            // Extract Date
            // Regex to match "D. Mon YYYY"
            const dateMatch = textContent.match(/^(\d{1,2})\.\s+([A-Za-z]{3})\s+(\d{4})/);
            
            if (dateMatch && href) {
                const day = parseInt(dateMatch[1]);
                const monthStr = dateMatch[2];
                const year = parseInt(dateMatch[3]);
                
                // Simple month mapping
                const months = {
                    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
                };
                
                const date = new Date(year, months[monthStr], day);
                
                // Update bounds
                if (date < minDate) minDate = date;
                if (date > maxDate) maxDate = date;
                
                entries.push({
                    date: date,
                    originalText: textContent,
                    href: href, // Relative path from index.html
                    title: textContent.includes('—') ? textContent.split('—')[1].trim() : 'Untitled'
                });
            }
        });

        // Set default date inputs
        if (entries.length > 0) {
            startDateInput.valueAsDate = minDate;
            endDateInput.valueAsDate = maxDate;
            entriesFoundCount.textContent = `Found ${entries.length} entries from ${formatDate(minDate)} to ${formatDate(maxDate)}`;
        }
    }

    // Helper: Update Stats
    function updateFilterStats() {
        const start = startDateInput.valueAsDate;
        const end = endDateInput.valueAsDate;
        
        if (!start || !end) return;

        // Reset to end of day for end date to be inclusive
        // Actually date inputs return 00:00 UTC usually, let's treat strictly
        
        const filtered = entries.filter(e => e.date >= start && e.date <= end);
        
        filterStats.textContent = `Selected range contains ${filtered.length} entries.`;
        convertBtn.disabled = filtered.length === 0;
        
        return filtered;
    }

    // Main Conversion Logic
    async function startConversion() {
        const filteredEntries = updateFilterStats();
        if (!filteredEntries || filteredEntries.length === 0) return;

        // Get Export Format
        const format = document.querySelector('input[name="exportFormat"]:checked').value; // 'zip' or 'single'
        
        showStatus('Converting', 'Initializing...', 0);
        
        const zip = new JSZip();
        let singleFileContent = '';
        let processed = 0;
        let errors = 0;
        
        // Sort entries by date ascending for single file
        filteredEntries.sort((a, b) => a.date - b.date);

        for (const entry of filteredEntries) {
            processed++;
            const percent = Math.round((processed / filteredEntries.length) * 100);
            updateStatus(`Processing ${processed}/${filteredEntries.length}: ${entry.title}`, percent);

            try {
                // Find file in map
                const targetKey = Array.from(fileMap.keys()).find(k => k.endsWith(entry.href));
                
                if (!targetKey) {
                    console.warn(`File not found for entry: ${entry.href}`);
                    errors++;
                    continue;
                }

                const file = fileMap.get(targetKey);
                const htmlContent = await readFileText(file);
                
                const markdown = parseEntryHtml(htmlContent, entry);
                
                if (format === 'zip') {
                    // Create filename: YYYY-MM-DD - Title.md
                    const safeTitle = entry.title.replace(/[\/\\:"*?<>|]/g, '_');
                    const dateStr = entry.date.toISOString().split('T')[0];
                    const filename = `${dateStr} - ${safeTitle}.md`;
                    zip.file(filename, markdown);
                } else {
                    // Single File Accumulation
                    singleFileContent += markdown + '\n\n---\n\n';
                }

            } catch (err) {
                console.error(`Error processing ${entry.title}`, err);
                errors++;
            }
        }

        updateStatus('Finalizing', format === 'zip' ? 'Generating Zip...' : 'Generating Markdown...', 100);
        
        let downloadUrl, filename;

        if (format === 'zip') {
            const blob = await zip.generateAsync({type: "blob"});
            downloadUrl = URL.createObjectURL(blob);
            filename = `Journal_Export_${new Date().toISOString().split('T')[0]}.zip`;
        } else {
            const blob = new Blob([singleFileContent], { type: 'text/markdown' });
            downloadUrl = URL.createObjectURL(blob);
            filename = `Journal_Full_Export_${new Date().toISOString().split('T')[0]}.md`;
        }
        
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        a.click();
        
        hideStatus();
        
        // Small delay to let UI render
        setTimeout(() => {
            alert(`Conversion complete! ${processed - errors} entries exported.`);
        }, 100);
    }

    // Helper: Parse Individual Entry HTML
    function parseEntryHtml(html, entryMetadata) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Custom Extraction Logic based on user request
        
        // 1. Get Title and Date if possible from doc, but we have metadata
        let content = `# ${entryMetadata.title}\n\n`;
        content += `*Date: ${formatDate(entryMetadata.date)}*\n\n---\n\n`;

        // 2. Extract Body Content
        // User sample: content is in <p> tags, often with class p2, but let's be generic
        // We want to avoid metadata tags like pageHeader/title which we already have
        
        // Strategy: 
        // Iterate over all elements in body.
        // Ignore .pageHeader, .title, .pageContainer (wrapper)
        // Look for:
        // - p tags (text)
        // - img/video (media - complex to handle if not bundled, but we can try to link? 
        //   Actually user said "extract raw text", maybe we skip media or just leave alt text?
        //   "extract the raw text without doing anychanges" -> imply text focus.
        //   But "parse it as a markdown file" -> markdown usually includes images.
        //   Since images are local files, they won't work in markdown unless we also export them.
        //   For now, let's stick to TEXT to keep it simple as requested, or just generic conversion.
        
        // Let's use Turndown on the specific content container or the whole body but filtered.
        
        // In user sample:
        // <div class='pageContainer'> contains everything.
        // inside: .pageHeader, .assetGrid (images), .title, .bodyText usually?
        // Wait, user sample: 
        // <p class="p1"><span class="s1"><div class='pageContainer'>...
        // This HTML is nested weirdly. div inside span inside p.
        
        // Let's target the "logic" content.
        // Text seems to be in <p class="p2"> siblings of the p1 container?
        // OR inside .bodyText div if it exists.
        
        // User Sample structure:
        // <body>
        //   <p class="p1">... <div class='pageContainer'> ... </div> ... </p>
        //   <p class="p2">Text 1</p>
        //   <p class="p2">Text 2</p>
        
        // So the main text is actually separate <p> tags at the root level (body > p).
        // The Header/Images are inside that first weird p1 block.
        
        // NEW STRATEGY: 
        // 1. Convert the entire body to markdown.
        // 2. Remove the "Page Header" / "Title" lines if they duplicate what we added.
        
        // Better Strategy:
        // Extract text from <p> tags that are NOT class "p1". 
        // In the sample, p1 holds the metadata/assets/header.
        // p2 holds the user content.
        // p3 is spacing.
        
        // Let's collect all <p> tags.
        const paragraphs = Array.from(doc.querySelectorAll('body > p'));
        let bodyMarkdown = '';
        
        paragraphs.forEach(p => {
            // content paragraph
            if (p.classList.contains('p2') || (!p.className && p.textContent.trim())) {
                bodyMarkdown += turndownService.turndown(p.innerHTML) + '\n\n';
            }
        });
        
        // If the structure is different (some journals might use divs), fallback to body
        if (!bodyMarkdown.trim()) {
            // Fallback: Remove known noise classes and dump body
            const clones = doc.body.cloneNode(true);
            const noise = clones.querySelectorAll('.pageHeader, .title, .assetGrid, .reflectionPrompt, .photoBanner, style, script');
            noise.forEach(n => n.remove());
            bodyMarkdown = turndownService.turndown(clones.innerHTML);
        }

        content += bodyMarkdown;
        return content;
    }

    // UI Helpers
    function showStatus(title, msg, percent) {
        statusOverlay.classList.remove('hidden');
        statusTitle.textContent = title;
        statusMessage.textContent = msg;
        updateStatus(msg, percent);
    }
    
    function updateStatus(msg, percent) {
        statusMessage.textContent = msg;
        progressFill.style.width = `${percent}%`;
    }

    function hideStatus() {
        statusOverlay.classList.add('hidden');
    }

    function formatDate(date) {
        return date.toLocaleDateString('en-DE'); // Match likely user locale based on sample
    }

    function readFileText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }
});
