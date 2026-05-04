// server.js — Pretty Cool Resume Builder Backend
// Node.js + Express + sqlite3
// Run with: node server.js

require('dotenv').config()

const express  = require('express')
const cors     = require('cors')
const path     = require('path')
const sqlite3  = require('sqlite3').verbose()
const { GoogleGenAI } = require('@google/genai')

// Create Express app
var app = express()

const PORT         = process.env.PORT || 3000
const DB_PATH      = process.env.DB_PATH || path.join(__dirname, 'resume.db')
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'

// Middleware
app.use(cors())
app.use(express.json())

// Serve index.html and static files from this directory
app.use(express.static(__dirname))

// Connect to SQLite database (creates it if it doesn't exist)
const db = new sqlite3.Database(DB_PATH, (objErr) => {
    if (objErr) {
        console.error('Failed to connect to database:', objErr.message)
    } else {
        console.log('Connected to SQLite database.')
    }
})

// SQLite performance and integrity settings
db.run('PRAGMA journal_mode = WAL')
db.run('PRAGMA foreign_keys = ON')

// Create all tables on first run
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS tblProfile (
        id        INTEGER PRIMARY KEY CHECK (id = 1),
        name      TEXT    DEFAULT '',
        email     TEXT    DEFAULT '',
        phone     TEXT    DEFAULT '',
        location  TEXT    DEFAULT '',
        link      TEXT    DEFAULT '',
        summary   TEXT    DEFAULT '',
        api_key   TEXT    DEFAULT ''
    )`)

    db.run(`INSERT OR IGNORE INTO tblProfile (id) VALUES (1)`)

    db.run(`CREATE TABLE IF NOT EXISTS tblJobs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT NOT NULL,
        company    TEXT NOT NULL,
        dates      TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS tblJob_bullets (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id     INTEGER NOT NULL REFERENCES tblJobs(id) ON DELETE CASCADE,
        bullet     TEXT    NOT NULL,
        sort_order INTEGER DEFAULT 0
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS tblSkills (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        name     TEXT NOT NULL,
        category TEXT NOT NULL
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS tblCertifications (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        name   TEXT NOT NULL,
        issuer TEXT DEFAULT '',
        year   TEXT DEFAULT ''
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS tblAwards (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        org         TEXT DEFAULT '',
        year        TEXT DEFAULT '',
        description TEXT DEFAULT ''
    )`)
})

// Gets the API key from the database, falls back to .env
function getActiveApiKey(fnCallback) {
    db.get('SELECT api_key FROM tblProfile WHERE id = 1', [], (objErr, objRow) => {
        if (objErr || !objRow) {
            fnCallback(process.env.GEMINI_API_KEY || '')
        } else {
            const strKey = (objRow.api_key && objRow.api_key.trim())
                ? objRow.api_key.trim()
                : (process.env.GEMINI_API_KEY || '')
            fnCallback(strKey)
        }
    })
}

// Strips the api_key field before sending profile data to the client
function getPublicProfile(objRow) {
    const { api_key, ...objPublicProfile } = objRow
    return objPublicProfile
}

// Sends a prompt to Gemini and returns the response text
async function callGemini(strPrompt) {
    return new Promise((fnResolve, fnReject) => {
        getActiveApiKey(async (strKey) => {
            if (!strKey) {
                fnReject(new Error('No Gemini API key configured. Add one in Settings or set GEMINI_API_KEY in .env.'))
                return
            }

            try {
                const objClient = new GoogleGenAI({ apiKey: strKey })
                const objResult = await objClient.models.generateContent({
                    model:    GEMINI_MODEL,
                    contents: strPrompt
                })
                fnResolve(objResult.text.trim())
            } catch (objError) {
                fnReject(objError)
            }
        })
    })
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

// Regex: matches MM/DD/YYYY, M/D/YY, and variants with - / or . as separator
const reDate = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/

// =====================================================
// AI ROUTES — /api/ai
// =====================================================

// GET /api/ai/suggest-summary
// Improves a draft professional summary using Gemini
// Query params: text (the draft summary)
app.get('/api/ai/suggest-summary', async (req, res, next) => {
    let strDraft = (req.query.text || '').trim()

    let blnError   = false
    let strMessage = ''

    if (strDraft.length < 1)    { blnError = true; strMessage += 'text query parameter is required.' }
    if (strDraft.length > 2000) { blnError = true; strMessage += 'text must be 2000 characters or fewer.' }

    if (blnError == false) {
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
            res.status(objGeminiError.status).json({ error: objGeminiError.message })
        }
    } else {
        res.status(400).json({ error: strMessage })
    }
})

// GET /api/ai/suggest-responsibility
// Improves a single job responsibility bullet using Gemini
// Query params: text (the bullet draft), jobtitle (optional context)
app.get('/api/ai/suggest-responsibility', async (req, res, next) => {
    let strDraft    = (req.query.text     || '').trim()
    let strJobTitle = (req.query.jobtitle || '').trim()

    let blnError   = false
    let strMessage = ''

    if (strDraft.length < 1)    { blnError = true; strMessage += 'text query parameter is required.' }
    if (strDraft.length > 1000) { blnError = true; strMessage += 'text must be 1000 characters or fewer.' }

    if (blnError == false) {
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
            res.status(objGeminiError.status).json({ error: objGeminiError.message })
        }
    } else {
        res.status(400).json({ error: strMessage })
    }
})

// =====================================================
// PROFILE ROUTES — /api/profile
// =====================================================

// GET /api/profile — returns the single profile row as a JSON array
app.get('/api/profile', (req, res, next) => {
    db.get('SELECT * FROM tblProfile WHERE id = 1', [], (objErr, objRow) => {
        if (objErr) {
            res.status(500).json({ error: objErr.message })
        } else {
            res.status(200).json([getPublicProfile(objRow)])
        }
    })
})

// PUT /api/profile — updates profile fields
// Body: { name, email, phone, location, link, summary, apiKey }
app.put('/api/profile', (req, res, next) => {
    db.get('SELECT * FROM tblProfile WHERE id = 1', [], (objErr, objExisting) => {
        if (objErr) {
            return res.status(500).json({ error: objErr.message })
        }

        // Use existing values as defaults if not provided
        let strName     = req.body.name     !== undefined ? req.body.name     : objExisting.name
        let strEmail    = req.body.email    !== undefined ? req.body.email    : objExisting.email
        let strPhone    = req.body.phone    !== undefined ? req.body.phone    : objExisting.phone
        let strLocation = req.body.location !== undefined ? req.body.location : objExisting.location
        let strLink     = req.body.link     !== undefined ? req.body.link     : objExisting.link
        let strSummary  = req.body.summary  !== undefined ? req.body.summary  : objExisting.summary
        let strApiKey   = req.body.apiKey   !== undefined ? req.body.apiKey   : objExisting.api_key

        const reEmail = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/

        let blnError   = false
        let strMessage = ''

        if (strEmail && !reEmail.test(strEmail)) { blnError = true; strMessage += 'Invalid email address format.' }

        if (blnError == false) {
            db.run(
                `UPDATE tblProfile SET name=?, email=?, phone=?, location=?, link=?, summary=?, api_key=? WHERE id = 1`,
                [strName, strEmail, strPhone, strLocation, strLink, strSummary, strApiKey],
                function (objRunErr) {
                    if (objRunErr) {
                        return res.status(500).json({ error: objRunErr.message })
                    }
                    db.get('SELECT * FROM tblProfile WHERE id = 1', [], (objGetErr, objUpdated) => {
                        if (objGetErr) {
                            return res.status(500).json({ error: objGetErr.message })
                        }
                        res.status(200).json([getPublicProfile(objUpdated)])
                    })
                }
            )
        } else {
            res.status(400).json({ error: strMessage })
        }
    })
})

// DELETE /api/data — clears all resume content, keeps the profile row
app.delete('/api/data', (req, res, next) => {
    db.serialize(() => {
        db.run('DELETE FROM tblJob_bullets')
        db.run('DELETE FROM tblJobs')
        db.run('DELETE FROM tblSkills')
        db.run('DELETE FROM tblCertifications')
        db.run('DELETE FROM tblAwards')
        db.run(
            `UPDATE tblProfile SET name='', email='', phone='', location='', link='', summary='' WHERE id = 1`,
            [],
            function (objErr) {
                if (objErr) {
                    return res.status(500).json({ error: objErr.message })
                }
                res.status(200).json({ success: true })
            }
        )
    })
})

// =====================================================
// JOBS ROUTES — /api/jobs
// =====================================================

// GET /api/jobs — returns all jobs with their bullets array
app.get('/api/jobs', (req, res, next) => {
    db.all('SELECT * FROM tblJobs ORDER BY created_at DESC', [], (objErr, arrJobs) => {
        if (objErr) {
            return res.status(500).json({ error: objErr.message })
        }

        if (arrJobs.length === 0) {
            return res.status(200).json([])
        }

        // Fetch bullets for each job
        let intCompleted = 0
        arrJobs.forEach((objJob, intIndex) => {
            db.all(
                'SELECT bullet FROM tblJob_bullets WHERE job_id = ? ORDER BY sort_order',
                [objJob.id],
                (objBulletErr, arrBullets) => {
                    if (objBulletErr) {
                        arrJobs[intIndex].bullets = []
                    } else {
                        arrJobs[intIndex].bullets = arrBullets.map(objRow => objRow.bullet)
                    }
                    intCompleted++
                    // Only send response once all jobs have their bullets
                    if (intCompleted === arrJobs.length) {
                        res.status(200).json(arrJobs)
                    }
                }
            )
        })
    })
})

// POST /api/jobs — creates a new job with optional bullet points
// Body: { title, company, dates, bullets[] }
app.post('/api/jobs', (req, res, next) => {
    let strTitle   = req.body.title   ? req.body.title   : ''
    let strCompany = req.body.company ? req.body.company : ''
    let strDates   = req.body.dates   ? req.body.dates   : ''
    let arrBullets = req.body.bullets ? req.body.bullets : []

    let blnError   = false
    let strMessage = ''

    if (strTitle.trim().length < 1)   { blnError = true; strMessage += 'title is required.' }
    if (strCompany.trim().length < 1) { blnError = true; strMessage += 'company is required.' }
    if (!Array.isArray(arrBullets))   { blnError = true; strMessage += 'bullets must be an array.' }

    // Validate date format if provided
    if (strDates) {
        const arrDateParts = strDates.split(/\s+\u2013\s+/)
        const strStart     = arrDateParts[0] || ''
        const strEnd       = arrDateParts[1] || ''

        if (strStart && !reDate.test(strStart)) { blnError = true; strMessage += 'Start date must be in MM/DD/YYYY format.' }
        if (strEnd && strEnd !== 'Present' && !reDate.test(strEnd)) { blnError = true; strMessage += 'End date must be in MM/DD/YYYY format or "Present".' }
    }

    if (blnError == false) {
        db.run(
            'INSERT INTO tblJobs (title, company, dates) VALUES (?, ?, ?)',
            [strTitle.trim(), strCompany.trim(), strDates],
            function (objErr) {
                if (objErr) {
                    return res.status(500).json({ error: objErr.message })
                }

                const intJobId = this.lastID

                // Filter out empty bullets
                const arrValidBullets = arrBullets.filter(strBullet => strBullet && strBullet.trim())

                if (arrValidBullets.length === 0) {
                    db.get('SELECT * FROM tblJobs WHERE id = ?', [intJobId], (objGetErr, objJob) => {
                        if (objGetErr) return res.status(500).json({ error: objGetErr.message })
                        res.status(201).json({ ...objJob, bullets: [] })
                    })
                    return
                }

                // Insert all bullets
                let intInserted = 0
                arrValidBullets.forEach((strBullet, intIndex) => {
                    db.run(
                        'INSERT INTO tblJob_bullets (job_id, bullet, sort_order) VALUES (?, ?, ?)',
                        [intJobId, strBullet.trim(), intIndex],
                        function (objBulletErr) {
                            intInserted++
                            if (intInserted === arrValidBullets.length) {
                                db.get('SELECT * FROM tblJobs WHERE id = ?', [intJobId], (objGetErr, objJob) => {
                                    if (objGetErr) return res.status(500).json({ error: objGetErr.message })
                                    db.all(
                                        'SELECT bullet FROM tblJob_bullets WHERE job_id = ? ORDER BY sort_order',
                                        [intJobId],
                                        (objFetchErr, arrFetched) => {
                                            if (objFetchErr) return res.status(500).json({ error: objFetchErr.message })
                                            res.status(201).json({ ...objJob, bullets: arrFetched.map(r => r.bullet) })
                                        }
                                    )
                                })
                            }
                        }
                    )
                })
            }
        )
    } else {
        res.status(400).json({ error: strMessage })
    }
})

// PUT /api/jobs/:id — replaces all fields and bullets for a job
// Body: { title, company, dates, bullets[] }
app.put('/api/jobs/:id', (req, res, next) => {
    let strId      = req.params.id
    let strTitle   = req.body.title   ? req.body.title   : ''
    let strCompany = req.body.company ? req.body.company : ''
    let strDates   = req.body.dates   ? req.body.dates   : ''
    let arrBullets = req.body.bullets ? req.body.bullets : []

    let blnError   = false
    let strMessage = ''

    if (!strId)                       { blnError = true; strMessage += 'Invalid job id.' }
    if (strTitle.trim().length < 1)   { blnError = true; strMessage += 'title is required.' }
    if (strCompany.trim().length < 1) { blnError = true; strMessage += 'company is required.' }
    if (!Array.isArray(arrBullets))   { blnError = true; strMessage += 'bullets must be an array.' }

    if (strDates) {
        const arrDateParts = strDates.split(/\s+\u2013\s+/)
        const strStart     = arrDateParts[0] || ''
        const strEnd       = arrDateParts[1] || ''

        if (strStart && !reDate.test(strStart)) { blnError = true; strMessage += 'Start date must be in MM/DD/YYYY format.' }
        if (strEnd && strEnd !== 'Present' && !reDate.test(strEnd)) { blnError = true; strMessage += 'End date must be in MM/DD/YYYY format or "Present".' }
    }

    if (blnError == false) {
        db.get('SELECT id FROM tblJobs WHERE id = ?', [strId], (objErr, objExisting) => {
            if (objErr) {
                return res.status(500).json({ error: objErr.message })
            }
            if (!objExisting) {
                return res.status(404).json({ error: 'Job not found.' })
            }

            db.run(
                'UPDATE tblJobs SET title=?, company=?, dates=? WHERE id=?',
                [strTitle.trim(), strCompany.trim(), strDates, strId],
                function (objUpdateErr) {
                    if (objUpdateErr) return res.status(500).json({ error: objUpdateErr.message })

                    // Delete old bullets then re-insert updated set
                    db.run('DELETE FROM tblJob_bullets WHERE job_id=?', [strId], function (objDeleteErr) {
                        if (objDeleteErr) return res.status(500).json({ error: objDeleteErr.message })

                        const arrValidBullets = arrBullets.filter(strBullet => strBullet && strBullet.trim())

                        if (arrValidBullets.length === 0) {
                            db.get('SELECT * FROM tblJobs WHERE id = ?', [strId], (objGetErr, objJob) => {
                                if (objGetErr) return res.status(500).json({ error: objGetErr.message })
                                res.status(200).json({ ...objJob, bullets: [] })
                            })
                            return
                        }

                        let intInserted = 0
                        arrValidBullets.forEach((strBullet, intIndex) => {
                            db.run(
                                'INSERT INTO tblJob_bullets (job_id, bullet, sort_order) VALUES (?, ?, ?)',
                                [strId, strBullet.trim(), intIndex],
                                function (objBulletErr) {
                                    intInserted++
                                    if (intInserted === arrValidBullets.length) {
                                        db.get('SELECT * FROM tblJobs WHERE id = ?', [strId], (objGetErr, objJob) => {
                                            if (objGetErr) return res.status(500).json({ error: objGetErr.message })
                                            db.all(
                                                'SELECT bullet FROM tblJob_bullets WHERE job_id = ? ORDER BY sort_order',
                                                [strId],
                                                (objFetchErr, arrFetched) => {
                                                    if (objFetchErr) return res.status(500).json({ error: objFetchErr.message })
                                                    res.status(200).json({ ...objJob, bullets: arrFetched.map(r => r.bullet) })
                                                }
                                            )
                                        })
                                    }
                                }
                            )
                        })
                    })
                }
            )
        })
    } else {
        res.status(400).json({ error: strMessage })
    }
})

// DELETE /api/jobs/:id — deletes a job by ID (cascades to bullets via FK)
app.delete('/api/jobs/:id', (req, res, next) => {
    let strId = req.params.id

    let blnError   = false
    let strMessage = ''

    if (!strId) { blnError = true; strMessage += 'Job id must be provided.' }

    if (blnError == false) {
        db.get('SELECT id FROM tblJobs WHERE id = ?', [strId], (objErr, objExisting) => {
            if (objErr) {
                return res.status(500).json({ error: objErr.message })
            }
            if (!objExisting) {
                return res.status(404).json({ error: 'Job not found.' })
            }

            db.run('DELETE FROM tblJobs WHERE id=?', [strId], function (objDeleteErr) {
                if (objDeleteErr) {
                    return res.status(500).json({ error: objDeleteErr.message })
                }
                res.status(200).json({ outcome: 'success', message: `Job with id ${strId} deleted` })
            })
        })
    } else {
        res.status(400).json({ error: strMessage })
    }
})

// =====================================================
// SKILLS ROUTES — /api/skills
// =====================================================

// GET /api/skills — returns all skills
app.get('/api/skills', (req, res, next) => {
    db.all('SELECT * FROM tblSkills', [], (objErr, arrRows) => {
        if (objErr) {
            return res.status(500).json({ error: objErr.message })
        }
        res.status(200).json(arrRows)
    })
})

// POST /api/skills — creates a skill entry
// Body: { name, category }
app.post('/api/skills', (req, res, next) => {
    let strName     = req.body.name     ? req.body.name     : ''
    let strCategory = req.body.category ? req.body.category : ''

    strName     = strName.trim()
    strCategory = strCategory.trim()

    let blnError   = false
    let strMessage = ''

    if (strName.length < 1)     { blnError = true; strMessage += 'name is required.' }
    if (strCategory.length < 1) { blnError = true; strMessage += 'category is required.' }

    if (blnError == false) {
        db.run(
            'INSERT INTO tblSkills (name, category) VALUES (?, ?)',
            [strName, strCategory],
            function (objErr) {
                if (objErr) {
                    return res.status(500).json({ error: objErr.message })
                }
                res.status(201).json({ id: this.lastID, name: strName, category: strCategory })
            }
        )
    } else {
        res.status(400).json({ error: strMessage })
    }
})

// PUT /api/skills/:id — updates a skill's name and category
// Body: { name, category }
app.put('/api/skills/:id', (req, res, next) => {
    let strId       = req.params.id
    let strName     = req.body.name     ? req.body.name     : ''
    let strCategory = req.body.category ? req.body.category : ''

    strName     = strName.trim()
    strCategory = strCategory.trim()

    let blnError   = false
    let strMessage = ''

    if (!strId)                 { blnError = true; strMessage += 'Invalid skill id.' }
    if (strName.length < 1)     { blnError = true; strMessage += 'name is required.' }
    if (strCategory.length < 1) { blnError = true; strMessage += 'category is required.' }

    if (blnError == false) {
        db.get('SELECT id FROM tblSkills WHERE id = ?', [strId], (objErr, objExisting) => {
            if (objErr) {
                return res.status(500).json({ error: objErr.message })
            }
            if (!objExisting) {
                return res.status(404).json({ error: 'Skill not found.' })
            }

            db.run(
                'UPDATE tblSkills SET name=?, category=? WHERE id=?',
                [strName, strCategory, strId],
                function (objUpdateErr) {
                    if (objUpdateErr) {
                        return res.status(500).json({ error: objUpdateErr.message })
                    }
                    res.status(200).json({ id: strId, name: strName, category: strCategory })
                }
            )
        })
    } else {
        res.status(400).json({ error: strMessage })
    }
})

// DELETE /api/skills/:id
app.delete('/api/skills/:id', (req, res, next) => {
    let strId = req.params.id

    let blnError   = false
    let strMessage = ''

    if (!strId) { blnError = true; strMessage += 'Skill id must be provided.' }

    if (blnError == false) {
        db.get('SELECT id FROM tblSkills WHERE id = ?', [strId], (objErr, objExisting) => {
            if (objErr) {
                return res.status(500).json({ error: objErr.message })
            }
            if (!objExisting) {
                return res.status(404).json({ error: 'Skill not found.' })
            }

            db.run('DELETE FROM tblSkills WHERE id=?', [strId], function (objDeleteErr) {
                if (objDeleteErr) {
                    return res.status(500).json({ error: objDeleteErr.message })
                }
                res.status(200).json({ outcome: 'success', message: `Skill with id ${strId} deleted` })
            })
        })
    } else {
        res.status(400).json({ error: strMessage })
    }
})

// =====================================================
// CERTIFICATIONS ROUTES — /api/certifications
// =====================================================

// GET /api/certifications — returns all certifications
app.get('/api/certifications', (req, res, next) => {
    db.all('SELECT * FROM tblCertifications', [], (objErr, arrRows) => {
        if (objErr) {
            return res.status(500).json({ error: objErr.message })
        }
        res.status(200).json(arrRows)
    })
})

// POST /api/certifications — creates a certification
// Body: { name, issuer, year }
app.post('/api/certifications', (req, res, next) => {
    let strName   = req.body.name   ? req.body.name   : ''
    let strIssuer = req.body.issuer ? req.body.issuer : ''
    let strYear   = req.body.year   ? req.body.year   : ''

    strName   = strName.trim()
    strIssuer = strIssuer.trim()
    strYear   = strYear.trim()

    let blnError   = false
    let strMessage = ''

    if (strName.length < 1) { blnError = true; strMessage += 'name is required.' }

    if (blnError == false) {
        db.run(
            'INSERT INTO tblCertifications (name, issuer, year) VALUES (?, ?, ?)',
            [strName, strIssuer, strYear],
            function (objErr) {
                if (objErr) {
                    return res.status(500).json({ error: objErr.message })
                }
                res.status(201).json({ id: this.lastID, name: strName, issuer: strIssuer, year: strYear })
            }
        )
    } else {
        res.status(400).json({ error: strMessage })
    }
})

// PUT /api/certifications/:id — updates a certification
// Body: { name, issuer, year }
app.put('/api/certifications/:id', (req, res, next) => {
    let strId     = req.params.id
    let strName   = req.body.name   ? req.body.name   : ''
    let strIssuer = req.body.issuer ? req.body.issuer : ''
    let strYear   = req.body.year   ? req.body.year   : ''

    strName   = strName.trim()
    strIssuer = strIssuer.trim()
    strYear   = strYear.trim()

    let blnError   = false
    let strMessage = ''

    if (!strId)             { blnError = true; strMessage += 'Invalid certification id.' }
    if (strName.length < 1) { blnError = true; strMessage += 'name is required.' }

    if (blnError == false) {
        db.get('SELECT id FROM tblCertifications WHERE id = ?', [strId], (objErr, objExisting) => {
            if (objErr) {
                return res.status(500).json({ error: objErr.message })
            }
            if (!objExisting) {
                return res.status(404).json({ error: 'Certification not found.' })
            }

            db.run(
                'UPDATE tblCertifications SET name=?, issuer=?, year=? WHERE id=?',
                [strName, strIssuer, strYear, strId],
                function (objUpdateErr) {
                    if (objUpdateErr) {
                        return res.status(500).json({ error: objUpdateErr.message })
                    }
                    res.status(200).json({ id: strId, name: strName, issuer: strIssuer, year: strYear })
                }
            )
        })
    } else {
        res.status(400).json({ error: strMessage })
    }
})

// DELETE /api/certifications/:id
app.delete('/api/certifications/:id', (req, res, next) => {
    let strId = req.params.id

    let blnError   = false
    let strMessage = ''

    if (!strId) { blnError = true; strMessage += 'Certification id must be provided.' }

    if (blnError == false) {
        db.get('SELECT id FROM tblCertifications WHERE id = ?', [strId], (objErr, objExisting) => {
            if (objErr) {
                return res.status(500).json({ error: objErr.message })
            }
            if (!objExisting) {
                return res.status(404).json({ error: 'Certification not found.' })
            }

            db.run('DELETE FROM tblCertifications WHERE id=?', [strId], function (objDeleteErr) {
                if (objDeleteErr) {
                    return res.status(500).json({ error: objDeleteErr.message })
                }
                res.status(200).json({ outcome: 'success', message: `Certification with id ${strId} deleted` })
            })
        })
    } else {
        res.status(400).json({ error: strMessage })
    }
})

// =====================================================
// AWARDS ROUTES — /api/awards
// =====================================================

// GET /api/awards — returns all awards
app.get('/api/awards', (req, res, next) => {
    db.all('SELECT * FROM tblAwards', [], (objErr, arrRows) => {
        if (objErr) {
            return res.status(500).json({ error: objErr.message })
        }
        res.status(200).json(arrRows)
    })
})

// POST /api/awards — creates an award
// Body: { name, org, year, description }
app.post('/api/awards', (req, res, next) => {
    let strName = req.body.name        ? req.body.name        : ''
    let strOrg  = req.body.org         ? req.body.org         : ''
    let strYear = req.body.year        ? req.body.year        : ''
    let strDesc = req.body.description ? req.body.description : ''

    strName = strName.trim()
    strOrg  = strOrg.trim()
    strYear = strYear.trim()
    strDesc = strDesc.trim()

    let blnError   = false
    let strMessage = ''

    if (strName.length < 1) { blnError = true; strMessage += 'name is required.' }

    if (blnError == false) {
        db.run(
            'INSERT INTO tblAwards (name, org, year, description) VALUES (?, ?, ?, ?)',
            [strName, strOrg, strYear, strDesc],
            function (objErr) {
                if (objErr) {
                    return res.status(500).json({ error: objErr.message })
                }
                res.status(201).json({ id: this.lastID, name: strName, org: strOrg, year: strYear, description: strDesc })
            }
        )
    } else {
        res.status(400).json({ error: strMessage })
    }
})

// PUT /api/awards/:id — updates an award
// Body: { name, org, year, description }
app.put('/api/awards/:id', (req, res, next) => {
    let strId   = req.params.id
    let strName = req.body.name        ? req.body.name        : ''
    let strOrg  = req.body.org         ? req.body.org         : ''
    let strYear = req.body.year        ? req.body.year        : ''
    let strDesc = req.body.description ? req.body.description : ''

    strName = strName.trim()
    strOrg  = strOrg.trim()
    strYear = strYear.trim()
    strDesc = strDesc.trim()

    let blnError   = false
    let strMessage = ''

    if (!strId)             { blnError = true; strMessage += 'Invalid award id.' }
    if (strName.length < 1) { blnError = true; strMessage += 'name is required.' }

    if (blnError == false) {
        db.get('SELECT id FROM tblAwards WHERE id = ?', [strId], (objErr, objExisting) => {
            if (objErr) {
                return res.status(500).json({ error: objErr.message })
            }
            if (!objExisting) {
                return res.status(404).json({ error: 'Award not found.' })
            }

            db.run(
                'UPDATE tblAwards SET name=?, org=?, year=?, description=? WHERE id=?',
                [strName, strOrg, strYear, strDesc, strId],
                function (objUpdateErr) {
                    if (objUpdateErr) {
                        return res.status(500).json({ error: objUpdateErr.message })
                    }
                    res.status(200).json({ id: strId, name: strName, org: strOrg, year: strYear, description: strDesc })
                }
            )
        })
    } else {
        res.status(400).json({ error: strMessage })
    }
})

// DELETE /api/awards/:id
app.delete('/api/awards/:id', (req, res, next) => {
    let strId = req.params.id

    let blnError   = false
    let strMessage = ''

    if (!strId) { blnError = true; strMessage += 'Award id must be provided.' }

    if (blnError == false) {
        db.get('SELECT id FROM tblAwards WHERE id = ?', [strId], (objErr, objExisting) => {
            if (objErr) {
                return res.status(500).json({ error: objErr.message })
            }
            if (!objExisting) {
                return res.status(404).json({ error: 'Award not found.' })
            }

            db.run('DELETE FROM tblAwards WHERE id=?', [strId], function (objDeleteErr) {
                if (objDeleteErr) {
                    return res.status(500).json({ error: objDeleteErr.message })
                }
                res.status(200).json({ outcome: 'success', message: `Award with id ${strId} deleted` })
            })
        })
    } else {
        res.status(400).json({ error: strMessage })
    }
})

// Catch-all — serve index.html for any unmatched GET route (SPA pattern)
app.get('*', (req, res, next) => {
    res.sendFile(path.join(__dirname, 'index.html'))
})

// Start server
app.listen(PORT, () => {
    console.log(`\nPretty Cool Resume Builder: http://localhost:${PORT}\n`)
})