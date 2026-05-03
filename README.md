# Pretty Cool Resume Builder
### CSC3100 Final Project

A locally-run resume builder that lets you focus on your content
and handles the formatting for you. Includes AI-powered suggestions
for your professional summary and job responsibilities using Google Gemini.

---

## Requirements

Before running this app, make sure you have the following installed:

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- npm (comes with Node.js)

---

## Installation

1. **Unzip the project folder** and open a terminal inside it.

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up your environment file:**

   Create a file named `.env` in the root of the project folder.
   You can copy the example below:
   ```
   PORT=3000
   GEMINI_API_KEY=your_key_here
   ```
   - `PORT` is optional but defaults to `3000` if not set
   - `GEMINI_API_KEY` is optional at startup but you can also add your key
     inside the app under **Settings, then Gemini API Key**

   > **Note:** If you do not have a Gemini API key, the app will still run.
   > The AI suggestion buttons will return an error until a key is provided.
   > Free API keys are available at [Google AI Studio](https://aistudio.google.com/).

---

## Running the App

Start the server with:
```bash
node server.js
```

Then open your browser and go to:
```
http://localhost:3000
```

To stop the server, press `Ctrl + C` in the terminal.

---

## Getting a Gemini API Key

1. Go to [https://aistudio.google.com/](https://aistudio.google.com/)
2. Sign in with a Google account
3. Click **Get API Key** and create a new key
4. Either paste it into your `.env` file as `GEMINI_API_KEY=your_key_here`,
   or enter it inside the app under **Settings then Gemini API Key**

The key is stored in the local SQLite database and is never committed to GitHub.

---

## Project Structure

```
pretty-cool-resume-builder/
├── index.html          # Main SPA shell
├── server.js           # Express backend + SQLite + Gemini API routes
├── js/
│   └── app.js          # Frontend JavaScript
├── vendor/
│   ├── bootstrap/      # Bootstrap 5.3 (local copy)
│   ├── bootstrap-icons/# Bootstrap Icons 1.13 (local copy)
│   └── sweetalert2/    # SweetAlert2 (local copy)
├── images/
│   ├── favicon.ico
│   └── apple-touch-icon.png
├── vitae.db            # SQLite database (auto-created on first run)
├── .env                # Your API key — DO NOT commit this file
├── .gitignore
├── package.json
├── AI_USAGE.md         # AI documentation
└── README.md           # This file
```

---

## Features

- **Personal Info** — name, contact details, LinkedIn, and professional summary
- **Work Experience** — add jobs with individual responsibility bullets;
  select which ones appear on each resume
- **Skills & Certifications** — categorized skills and dated certifications
- **Awards & Honors** — scholarships, dean's list, hackathon wins, etc.
- **Resume Preview** — pick exactly which jobs and bullets to include,
  then preview and print/save as PDF
- **AI Suggestions** — Gemini-powered improvements for your summary and
  responsibility bullets
- **Settings** — save your own Gemini API key and clear all stored data

---

## Printing / Saving as PDF

Navigate to **Resume Preview**, click **Build Preview**, then click
**Print / Save PDF**. In the print dialog, choose **Save as PDF** as
the destination for a clean, formatted output.

---

## Dependencies & Attributions

All libraries are stored locally in the `vendor/` directory.
An attributions popup is available in the app by clicking
**Open Source Libraries** at the bottom of the sidebar.

| Library | Version | License |
|---------|---------|---------|
| Bootstrap | 5.3 | MIT |
| Bootstrap Icons | 1.13 | MIT |
| Express.js | — | MIT |
| better-sqlite3 | — | MIT |
| @google/genai | — | Apache 2.0 |
| dotenv | — | BSD-2-Clause |
| cors | — | MIT |
| SweetAlert2 | — | MIT |

---

## GitHub Repository

https://github.com/MellowKat04/WebDevFinalProject

---

## Notes for the Instructor

- The `.env` file is excluded from the ZIP and the GitHub repository via `.gitignore`
- The SQLite database (`vitae.db`) is auto-created on first run. No setup needed
- All vendor libraries are included locally; no CDNs are used
- Lighthouse accessibility score documentation is included in the submission
