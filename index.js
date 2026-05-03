// server.js — Pretty Cool Resume Builder Backend
// Node.js + Express + better-sqlite3
// Run with: node server.js

require('dotenv').config()

const express  = require('express')
const cors     = require('cors')
const path     = require('path')
const Database = require('better-sqlite3')
const { GoogleGenAI } = require('@google/genai')

// Create Express app
var app = express()

const PORT         = process.env.PORT || 3000
const DB_PATH      = process.env.DB_PATH || path.join(__dirname, 'vitae.db')
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'

// Middleware
app.use(cors())
app.use(express.json())

// Serve index.html and static files from this directory
app.use(express.static(__dirname))

// Connect to SQLite database (creates it if it doesn't exist)
const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Create all tables on first run
db.exec(`
  CREATE TABLE IF NOT EXISTS tblProfile (
    id        INTEGER PRIMARY KEY CHECK (id = 1),
    name      TEXT    DEFAULT '',
    email     TEXT    DEFAULT '',
    phone     TEXT    DEFAULT '',
    location  TEXT    DEFAULT '',
    link      TEXT    DEFAULT '',
    summary   TEXT    DEFAULT '',
    api_key   TEXT    DEFAULT ''
  );

  INSERT OR IGNORE INTO tblProfile (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS tblJobs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    company    TEXT NOT NULL,
    dates      TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tblJob_bullets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     INTEGER NOT NULL REFERENCES tblJobs(id) ON DELETE CASCADE,
    bullet     TEXT    NOT NULL,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tblSkills (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    category TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tblCertifications (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    name   TEXT NOT NULL,
    issuer TEXT DEFAULT '',
    year   TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS tblAwards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    org         TEXT DEFAULT '',
    year        TEXT DEFAULT '',
    description TEXT DEFAULT ''
  );
`)

// Builds a consistent JSON error response
function sendError(res, intStatus, strMessage) {
    return res.status(intStatus).json({ error: strMessage })
}

// Gets the API key from the database, falls back to .env
function getActiveApiKey() {
    const objProfile = db.prepare('SELECT api_key FROM tblProfile WHERE id = 1').get()
    return (objProfile && objProfile.api_key && objProfile.api_key.trim())
        ? objProfile.api_key.trim()
        : (process.env.GEMINI_API_KEY || '')
}

// Strips the api_key field before sending profile data to the client
function getPublicProfile(objRow) {
    const { api_key, ...objPublicProfile } = objRow
    return objPublicProfile
}

// Sends a prompt to Gemini and returns the response text
async function callGemini(strPrompt) {
    const strKey = getActiveApiKey()

    if (!strKey) {
        throw new Error('No Gemini API key configured. Add one in Settings or set GEMINI_API_KEY in .env.')
    }

    const objClient = new GoogleGenAI({ apiKey: strKey })

    const objResult = await objClient.models.generateContent({
        model:    GEMINI_MODEL,
        contents: strPrompt
    })

    return objResult.text.trim()
}

// Maps Gemini error messages to user-friendly status codes and messages
function getGeminiErrorMessage(objError) {
    const strMessage = objError.message || ''

    if (strMessage.includes('No Gemini API key')) {
        return { status: 503, message: strMessage }
    }
    if (strMessage.includes('RESOURCE_EXHAUSTED') || strMessage.includes('"code":429')) {
        return {
            status:  429,
            message: `Gemini quota was reached for ${GEMINI_MODEL}. Wait a minute and try again, or save a key from a different Google AI Studio project.`
        }
    }
    if (strMessage.includes('API key not valid') || strMessage.includes('PERMISSION_DENIED')) {
        return { status: 401, message: 'Gemini rejected this API key. Check the key in Settings and try again.' }
    }

    return { status: 502, message: 'AI service unavailable. Check your API key and try again.' }
}

// Returns all jobs with their bullet arrays attached
function getJobsWithBullets() {
    const arrJobs     = db.prepare('SELECT * FROM tblJobs ORDER BY created_at DESC').all()
    const stmtBullets = db.prepare('SELECT bullet FROM tblJob_bullets WHERE job_id = ? ORDER BY sort_order')
    return arrJobs.map(objJob => ({
        ...objJob,
        bullets: stmtBullets.all(objJob.id).map(objRow => objRow.bullet)
    }))
}

// Regex: matches MM/DD/YYYY, M/D/YY, and variants with - / or . as separator
const reDate = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/

// =====================================================
// AI ROUTES — /api/ai
// =====================================================

// GET /api/ai/suggest-summary
// Improves a draft professional summary using Gemini
// Query params: text (the draft summary)
app.get('/api/ai/suggest-summary', async (req, res) => {
    let strDraft = (req.query.text || '').trim()

    if (strDraft.length < 1)    return sendError(res, 400, 'text query parameter is required.')
    if (strDraft.length > 2000) return sendError(res, 400, 'text must be 2000 characters or fewer.')

    const strPrompt = `You are a professional resume coach helping a college student improve their resume.

Rewrite the following professional summary to make it more concise, impactful, and employer-ready.
Use active voice and strong action verbs. Keep it to 2-3 sentences.
Return ONLY the improved summary text. No explanations, no labels, no quotation marks.

Draft summary:
${strDraft}`

    try {
        const strSuggestion = await callGemini(strPrompt)
        res.status(200).json({ suggestion: strSuggestion })
    } catch (objError) {
        console.error('Gemini suggest-summary error:', objError.message)
        const objGeminiError = getGeminiErrorMessage(objError)
        sendError(res, objGeminiError.status, objGeminiError.message)
    }
})

// GET /api/ai/suggest-responsibility
// Improves a single job responsibility bullet using Gemini
// Query params: text (the bullet draft), jobtitle (optional context)
app.get('/api/ai/suggest-responsibility', async (req, res) => {
    let strDraft    = (req.query.text     || '').trim()
    let strJobTitle = (req.query.jobtitle || '').trim()

    if (strDraft.length < 1)    return sendError(res, 400, 'text query parameter is required.')
    if (strDraft.length > 1000) return sendError(res, 400, 'text must be 1000 characters or fewer.')

    const strContext = strJobTitle ? ` for a ${strJobTitle} role` : ''
    const strPrompt  = `You are a professional resume coach helping a college student improve their resume.

Rewrite the following job responsibility bullet point${strContext} to be more impactful and quantifiable.
Use a strong past-tense action verb at the start. Be specific and results-oriented. Keep it to one sentence.
Return ONLY the improved bullet text — no explanations, no labels, no leading dash or bullet character.

Draft responsibility:
${strDraft}`

    try {
        const strSuggestion = await callGemini(strPrompt)
        res.status(200).json({ suggestion: strSuggestion })
    } catch (objError) {
        console.error('Gemini suggest-responsibility error:', objError.message)
        const objGeminiError = getGeminiErrorMessage(objError)
        sendError(res, objGeminiError.status, objGeminiError.message)
    }
})

// =====================================================
// PROFILE ROUTES — /api/profile
// =====================================================

// GET /api/profile — returns the single profile row as a JSON array
app.get('/api/profile', (req, res) => {
    const objRow = db.prepare('SELECT * FROM tblProfile WHERE id = 1').get()
    res.status(200).json([getPublicProfile(objRow)])
})

// PUT /api/profile — updates profile fields
// Body: { name, email, phone, location, link, summary, apiKey }
app.put('/api/profile', (req, res) => {
    const objExisting = db.prepare('SELECT * FROM tblProfile WHERE id = 1').get()

    // Use existing values as defaults if not provided
    let strName     = req.body.name     !== undefined ? req.body.name     : objExisting.name
    let strEmail    = req.body.email    !== undefined ? req.body.email    : objExisting.email
    let strPhone    = req.body.phone    !== undefined ? req.body.phone    : objExisting.phone
    let strLocation = req.body.location !== undefined ? req.body.location : objExisting.location
    let strLink     = req.body.link     !== undefined ? req.body.link     : objExisting.link
    let strSummary  = req.body.summary  !== undefined ? req.body.summary  : objExisting.summary
    let strApiKey   = req.body.apiKey   !== undefined ? req.body.apiKey   : objExisting.api_key

    // Validate email format if provided
    const reEmail = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
    if (strEmail && !reEmail.test(strEmail)) {
        return sendError(res, 400, 'Invalid email address format.')
    }

    db.prepare(`
        UPDATE tblProfile
        SET name=?, email=?, phone=?, location=?, link=?, summary=?, api_key=?
        WHERE id = 1
    `).run(strName, strEmail, strPhone, strLocation, strLink, strSummary, strApiKey)

    const objUpdated = db.prepare('SELECT * FROM tblProfile WHERE id = 1').get()
    res.status(200).json([getPublicProfile(objUpdated)])
})

// DELETE /api/data — clears all resume content, keeps the profile row
app.delete('/api/data', (req, res) => {
    db.transaction(() => {
        db.prepare('DELETE FROM tblJob_bullets').run()
        db.prepare('DELETE FROM tblJobs').run()
        db.prepare('DELETE FROM tblSkills').run()
        db.prepare('DELETE FROM tblCertifications').run()
        db.prepare('DELETE FROM tblAwards').run()
        db.prepare(`UPDATE tblProfile SET name='', email='', phone='', location='', link='', summary='' WHERE id = 1`).run()
    })()

    res.status(200).json({ success: true })
})

// =====================================================
// JOBS ROUTES — /api/jobs
// =====================================================

// GET /api/jobs — returns all jobs with their bullets array
app.get('/api/jobs', (req, res) => {
    res.status(200).json(getJobsWithBullets())
})

// POST /api/jobs — creates a new job with optional bullet points
// Body: { title, company, dates, bullets[] }
app.post('/api/jobs', (req, res) => {
    let strTitle   = req.body.title   || ''
    let strCompany = req.body.company || ''
    let strDates   = req.body.dates   || ''
    let arrBullets = req.body.bullets || []

    // Validate required fields
    let blnError  = false
    let strMessage = ''

    if (!strTitle.trim())   { blnError = true; strMessage += 'title is required.' }
    if (!strCompany.trim()) { blnError = true; strMessage += 'company is required.' }
    if (!Array.isArray(arrBullets)) { blnError = true; strMessage += 'bullets must be an array.' }

    // Validate date format if provided — "Present" is valid for current jobs
    if (strDates) {
        const arrDateParts = strDates.split(/\s+\u2013\s+/)
        const strStart     = arrDateParts[0] || ''
        const strEnd       = arrDateParts[1] || ''

        if (strStart && !reDate.test(strStart)) { blnError = true; strMessage += 'Start date must be in MM/DD/YYYY format.' }
        if (strEnd && strEnd !== 'Present' && !reDate.test(strEnd)) { blnError = true; strMessage += 'End date must be in MM/DD/YYYY format or "Present".' }
    }

    if (blnError) return sendError(res, 400, strMessage)

    // Insert job and bullets together in a transaction
    const intJobId = db.transaction(() => {
        const objResult = db.prepare('INSERT INTO tblJobs (title, company, dates) VALUES (?, ?, ?)').run(strTitle.trim(), strCompany.trim(), strDates)
        const intId     = objResult.lastInsertRowid
        const stmtBullet = db.prepare('INSERT INTO tblJob_bullets (job_id, bullet, sort_order) VALUES (?, ?, ?)')
        arrBullets.forEach((strBullet, intIndex) => {
            if (strBullet && strBullet.trim()) stmtBullet.run(intId, strBullet.trim(), intIndex)
        })
        return intId
    })()

    const objJob     = db.prepare('SELECT * FROM tblJobs WHERE id = ?').get(intJobId)
    const arrFetched = db.prepare('SELECT bullet FROM tblJob_bullets WHERE job_id = ? ORDER BY sort_order').all(intJobId).map(r => r.bullet)

    res.status(201).json({ ...objJob, bullets: arrFetched })
})

// PUT /api/jobs/:id — replaces all fields and bullets for a job
// Body: { title, company, dates, bullets[] }
app.put('/api/jobs/:id', (req, res) => {
    const intId    = Number(req.params.id)
    let strTitle   = req.body.title   || ''
    let strCompany = req.body.company || ''
    let strDates   = req.body.dates   || ''
    let arrBullets = req.body.bullets || []

    let blnError   = false
    let strMessage = ''

    if (!Number.isInteger(intId) || intId < 1) { blnError = true; strMessage += 'Invalid job id.' }
    if (!strTitle.trim())   { blnError = true; strMessage += 'title is required.' }
    if (!strCompany.trim()) { blnError = true; strMessage += 'company is required.' }
    if (!Array.isArray(arrBullets)) { blnError = true; strMessage += 'bullets must be an array.' }

    if (strDates) {
        const arrDateParts = strDates.split(/\s+\u2013\s+/)
        const strStart     = arrDateParts[0] || ''
        const strEnd       = arrDateParts[1] || ''

        if (strStart && !reDate.test(strStart)) { blnError = true; strMessage += 'Start date must be in MM/DD/YYYY format.' }
        if (strEnd && strEnd !== 'Present' && !reDate.test(strEnd)) { blnError = true; strMessage += 'End date must be in MM/DD/YYYY format or "Present".' }
    }

    if (blnError) return sendError(res, 400, strMessage)

    const objExisting = db.prepare('SELECT id FROM tblJobs WHERE id = ?').get(intId)
    if (!objExisting) return sendError(res, 404, 'Job not found.')

    db.transaction(() => {
        db.prepare('UPDATE tblJobs SET title=?, company=?, dates=? WHERE id=?').run(strTitle.trim(), strCompany.trim(), strDates, intId)
        // Delete old bullets and re-insert the updated set
        db.prepare('DELETE FROM tblJob_bullets WHERE job_id=?').run(intId)
        const stmtBullet = db.prepare('INSERT INTO tblJob_bullets (job_id, bullet, sort_order) VALUES (?, ?, ?)')
        arrBullets.forEach((strBullet, intIndex) => {
            if (strBullet && strBullet.trim()) stmtBullet.run(intId, strBullet.trim(), intIndex)
        })
    })()

    const objJob     = db.prepare('SELECT * FROM tblJobs WHERE id = ?').get(intId)
    const arrFetched = db.prepare('SELECT bullet FROM tblJob_bullets WHERE job_id = ? ORDER BY sort_order').all(intId).map(r => r.bullet)

    res.status(200).json({ ...objJob, bullets: arrFetched })
})

// DELETE /api/jobs/:id — deletes a job by ID (cascades to bullets via FK)
app.delete('/api/jobs/:id', (req, res) => {
    const intId = Number(req.params.id)

    if (!Number.isInteger(intId) || intId < 1) return sendError(res, 400, 'Invalid job id.')

    const objExisting = db.prepare('SELECT id FROM tblJobs WHERE id = ?').get(intId)
    if (!objExisting) return sendError(res, 404, 'Job not found.')

    db.prepare('DELETE FROM tblJobs WHERE id=?').run(intId)
    res.status(200).json({ success: true })
})

// =====================================================
// SKILLS ROUTES — /api/skills
// =====================================================

// GET /api/skills — returns all skills
app.get('/api/skills', (req, res) => {
    res.status(200).json(db.prepare('SELECT * FROM tblSkills').all())
})

// POST /api/skills — creates a skill entry
// Body: { name, category }
app.post('/api/skills', (req, res) => {
    let strName     = req.body.name     || ''
    let strCategory = req.body.category || ''

    let blnError   = false
    let strMessage = ''

    if (!strName.trim())     { blnError = true; strMessage += 'name is required.' }
    if (!strCategory.trim()) { blnError = true; strMessage += 'category is required.' }

    if (blnError) return sendError(res, 400, strMessage)

    const objResult = db.prepare('INSERT INTO tblSkills (name, category) VALUES (?, ?)').run(strName.trim(), strCategory.trim())
    res.status(201).json({ id: objResult.lastInsertRowid, name: strName.trim(), category: strCategory.trim() })
})

// PUT /api/skills/:id — updates a skill's name and category
// Body: { name, category }
app.put('/api/skills/:id', (req, res) => {
    const intId     = Number(req.params.id)
    let strName     = req.body.name     || ''
    let strCategory = req.body.category || ''

    let blnError   = false
    let strMessage = ''

    if (!Number.isInteger(intId) || intId < 1) { blnError = true; strMessage += 'Invalid skill id.' }
    if (!strName.trim())     { blnError = true; strMessage += 'name is required.' }
    if (!strCategory.trim()) { blnError = true; strMessage += 'category is required.' }

    if (blnError) return sendError(res, 400, strMessage)

    const objExisting = db.prepare('SELECT id FROM tblSkills WHERE id = ?').get(intId)
    if (!objExisting) return sendError(res, 404, 'Skill not found.')

    db.prepare('UPDATE tblSkills SET name=?, category=? WHERE id=?').run(strName.trim(), strCategory.trim(), intId)
    res.status(200).json({ id: intId, name: strName.trim(), category: strCategory.trim() })
})

// DELETE /api/skills/:id
app.delete('/api/skills/:id', (req, res) => {
    const intId = Number(req.params.id)

    if (!Number.isInteger(intId) || intId < 1) return sendError(res, 400, 'Invalid skill id.')

    const objExisting = db.prepare('SELECT id FROM tblSkills WHERE id = ?').get(intId)
    if (!objExisting) return sendError(res, 404, 'Skill not found.')

    db.prepare('DELETE FROM tblSkills WHERE id=?').run(intId)
    res.status(200).json({ success: true })
})

// =====================================================
// CERTIFICATIONS ROUTES — /api/certifications
// =====================================================

// GET /api/certifications — returns all certifications
app.get('/api/certifications', (req, res) => {
    res.status(200).json(db.prepare('SELECT * FROM tblCertifications').all())
})

// POST /api/certifications — creates a certification
// Body: { name, issuer, year }
app.post('/api/certifications', (req, res) => {
    let strName   = req.body.name   || ''
    let strIssuer = req.body.issuer || ''
    let strYear   = req.body.year   || ''

    if (!strName.trim()) return sendError(res, 400, 'name is required.')

    const objResult = db.prepare('INSERT INTO tblCertifications (name, issuer, year) VALUES (?, ?, ?)').run(strName.trim(), strIssuer.trim(), strYear.trim())
    res.status(201).json({ id: objResult.lastInsertRowid, name: strName.trim(), issuer: strIssuer.trim(), year: strYear.trim() })
})

// PUT /api/certifications/:id — updates a certification
// Body: { name, issuer, year }
app.put('/api/certifications/:id', (req, res) => {
    const intId   = Number(req.params.id)
    let strName   = req.body.name   || ''
    let strIssuer = req.body.issuer || ''
    let strYear   = req.body.year   || ''

    if (!Number.isInteger(intId) || intId < 1) return sendError(res, 400, 'Invalid certification id.')
    if (!strName.trim()) return sendError(res, 400, 'name is required.')

    const objExisting = db.prepare('SELECT id FROM tblCertifications WHERE id = ?').get(intId)
    if (!objExisting) return sendError(res, 404, 'Certification not found.')

    db.prepare('UPDATE tblCertifications SET name=?, issuer=?, year=? WHERE id=?').run(strName.trim(), strIssuer.trim(), strYear.trim(), intId)
    res.status(200).json({ id: intId, name: strName.trim(), issuer: strIssuer.trim(), year: strYear.trim() })
})

// DELETE /api/certifications/:id
app.delete('/api/certifications/:id', (req, res) => {
    const intId = Number(req.params.id)

    if (!Number.isInteger(intId) || intId < 1) return sendError(res, 400, 'Invalid certification id.')

    const objExisting = db.prepare('SELECT id FROM tblCertifications WHERE id = ?').get(intId)
    if (!objExisting) return sendError(res, 404, 'Certification not found.')

    db.prepare('DELETE FROM tblCertifications WHERE id=?').run(intId)
    res.status(200).json({ success: true })
})

// =====================================================
// AWARDS ROUTES — /api/awards
// =====================================================

// GET /api/awards — returns all awards
app.get('/api/awards', (req, res) => {
    res.status(200).json(db.prepare('SELECT * FROM tblAwards').all())
})

// POST /api/awards — creates an award
// Body: { name, org, year, description }
app.post('/api/awards', (req, res) => {
    let strName = req.body.name        || ''
    let strOrg  = req.body.org         || ''
    let strYear = req.body.year        || ''
    let strDesc = req.body.description || ''

    if (!strName.trim()) return sendError(res, 400, 'name is required.')

    const objResult = db.prepare('INSERT INTO tblAwards (name, org, year, description) VALUES (?, ?, ?, ?)').run(strName.trim(), strOrg.trim(), strYear.trim(), strDesc.trim())
    res.status(201).json({ id: objResult.lastInsertRowid, name: strName.trim(), org: strOrg.trim(), year: strYear.trim(), description: strDesc.trim() })
})

// PUT /api/awards/:id — updates an award
// Body: { name, org, year, description }
app.put('/api/awards/:id', (req, res) => {
    const intId = Number(req.params.id)
    let strName = req.body.name        || ''
    let strOrg  = req.body.org         || ''
    let strYear = req.body.year        || ''
    let strDesc = req.body.description || ''

    if (!Number.isInteger(intId) || intId < 1) return sendError(res, 400, 'Invalid award id.')
    if (!strName.trim()) return sendError(res, 400, 'name is required.')

    const objExisting = db.prepare('SELECT id FROM tblAwards WHERE id = ?').get(intId)
    if (!objExisting) return sendError(res, 404, 'Award not found.')

    db.prepare('UPDATE tblAwards SET name=?, org=?, year=?, description=? WHERE id=?').run(strName.trim(), strOrg.trim(), strYear.trim(), strDesc.trim(), intId)
    res.status(200).json({ id: intId, name: strName.trim(), org: strOrg.trim(), year: strYear.trim(), description: strDesc.trim() })
})

// DELETE /api/awards/:id
app.delete('/api/awards/:id', (req, res) => {
    const intId = Number(req.params.id)

    if (!Number.isInteger(intId) || intId < 1) return sendError(res, 400, 'Invalid award id.')

    const objExisting = db.prepare('SELECT id FROM tblAwards WHERE id = ?').get(intId)
    if (!objExisting) return sendError(res, 404, 'Award not found.')

    db.prepare('DELETE FROM tblAwards WHERE id=?').run(intId)
    res.status(200).json({ success: true })
})

// Catch-all — serve index.html for any unmatched GET route (SPA pattern)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'))
})

// Start server
app.listen(PORT, () => {
    console.log(`\n✅  Pretty Cool Resume Builder → http://localhost:${PORT}\n`)
})