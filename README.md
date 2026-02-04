# Apple Journal to Markdown Converter

A secure, client-side web tool to convert your Apple Journal HTML exports into clean, organized Markdown files.

## Features
- **Privacy First**: Runs entirely in your browser. No data is ever uploaded to any server.
- **Bulk Conversion**: Process your entire Journal export in one go.
- **Multiple Export Formats**: Choose between individual Markdown files (ZIP) or one single consolidated Markdown file.
- **Date Filtering**: Select a specific date range to export only the entries you need.
- **Clean Markdown**: Intelligently extracts the content, removing menus and redundant headers.
- **Zip/File Download**: Get all your converted files instantly.

## How to Check Your Journal
1. Open the Apple Journal app on your iPhone.
2. Go to your Profile/Settings and request an "Export All Data".
3. Once you receive the zip file, unzip it on your computer.
4. You should see a folder containing `index.html` and an `Entries` subfolder.

## Usage
1. Open this tool (via `index.html` or the deployed version).
2. Click **Browse Folder** and select the *root* folder of your unzipped journal export.
3. The tool will analyze your entries and show a date range.
4. Adjust the **Start Date** and **End Date** if needed.
5. Click **Convert & Download Zip**.

## Development
To run locally:
```bash
# Clone the repo
git clone https://github.com/Derururu/JournalToMarkdown.git

# Navigate to directory
cd JournalToMarkdown

# Start a local server (optional, but recommended)
python3 -m http.server 8080
# Open http://localhost:8080 in your browser
```
