// app.js — Pretty Cool Resume Builder

// In-memory state that mirrors the database
let objPersonal    = {}
let arrJobs        = []   // [{ id, title, company, start, end, current, responsibilities:[] }]
let arrSkills      = []   // [{ id, name, category }]
let arrCerts       = []   // [{ id, name, issuer, date }]
let arrAwards      = []   // [{ id, name, org, date, desc }]

// Temp array for responsibilities being staged on the current job form
let arrPendingResp = []

// Base URL for all API calls (same origin as the page)
const strApiBase = ''

// Regex patterns for validation
const reEmail = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
// Date: matches MM/DD/YYYY, M/D/YY, and variants with - / or . as separator
const reDate  = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/

// =====================================================
// PERSISTENCE — SQLite-backed REST API
// =====================================================

// Wrapper around fetch that throws on non-OK responses
async function apiRequest(strUrl, objOptions = {}) {
    const objResponse = await fetch(`${strApiBase}${strUrl}`, objOptions)

    if(!objResponse.ok) {
        let strMessage = `Server responded with status ${objResponse.status}`
        try {
            const objError = await objResponse.json()
            strMessage = objError.error || strMessage
        } catch(objIgnored) {
            // Keep the generic message if the response is not JSON
        }
        throw new Error(strMessage)
    }

    return objResponse.json()
}

// Splits a full name string into first and last name parts
function splitName(strName) {
    const arrParts = (strName || '').trim().split(/\s+/).filter(Boolean)
    return {
        firstName: arrParts.shift() || '',
        lastName:  arrParts.join(' ')
    }
}

// Splits a "City, State, ZIP" location string into its parts
function splitLocation(strLocation) {
    const arrParts = (strLocation || '').split(',').map((strPart) => strPart.trim())
    return {
        city:  arrParts[0] || '',
        state: arrParts[1] || 'TN',
        zip:   arrParts[2] || ''
    }
}

// Maps a raw API profile row to the local objPersonal shape
function mapApiProfile(objRow) {
    const objName     = splitName(objRow.name)
    const objLocation = splitLocation(objRow.location)

    return {
        firstName: objName.firstName,
        lastName:  objName.lastName,
        email:     objRow.email   || '',
        phone:     objRow.phone   || '',
        city:      objLocation.city,
        state:     objLocation.state,
        zip:       objLocation.zip,
        linkedin:  objRow.link    || '',
        summary:   objRow.summary || ''
    }
}

// Maps a raw API job row to the local arrJobs shape
function mapApiJob(objJob) {
    // Split the stored "MM/DD/YYYY – MM/DD/YYYY" string on the en dash separator
    const arrDates = (objJob.dates || '').split(/\s+\u2013\s+/)
    return {
        id:               objJob.id,
        title:            objJob.title,
        company:          objJob.company,
        start:            arrDates[0] || '',
        end:              arrDates[1] || '',
        current:          (arrDates[1] || '') === 'Present',
        responsibilities: objJob.bullets || []
    }
}

// Maps a raw API certification row to the local arrCerts shape
function mapApiCert(objCert) {
    return {
        id:     objCert.id,
        name:   objCert.name,
        issuer: objCert.issuer || '',
        date:   objCert.year   || ''
    }
}

// Maps a raw API award row to the local arrAwards shape
function mapApiAward(objAward) {
    return {
        id:   objAward.id,
        name: objAward.name,
        org:  objAward.org         || '',
        date: objAward.year        || '',
        desc: objAward.description || ''
    }
}

// Loads all data from the API into the in-memory state arrays
async function loadState() {
    const [arrProfileRows, arrApiJobs, arrApiSkills, arrApiCerts, arrApiAwards] = await Promise.all([
        apiRequest('/api/profile'),
        apiRequest('/api/jobs'),
        apiRequest('/api/skills'),
        apiRequest('/api/certifications'),
        apiRequest('/api/awards')
    ])

    objPersonal = mapApiProfile(arrProfileRows[0] || {})
    arrJobs     = arrApiJobs.map(mapApiJob)
    arrSkills   = arrApiSkills
    arrCerts    = arrApiCerts.map(mapApiCert)
    arrAwards   = arrApiAwards.map(mapApiAward)
}

// Prevent XSS when writing user input into the DOM via innerHTML
function escapeHtml(strInput) {
    if(!strInput) { return '' }
    return String(strInput)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#039;')
}

// Show a brief Bootstrap toast notification in the bottom-right corner
function showToast(strMessage) {
    document.querySelector('#toastMsg').textContent = strMessage
    const objToastEl = document.querySelector('#toastNotif')
    const objToast   = new bootstrap.Toast(objToastEl, { delay: 2500 })
    objToast.show()
}

// =====================================================
// SPA NAVIGATION — show/hide sections
// =====================================================

const arrSections = [
    'sectionPersonal',
    'sectionJobs',
    'sectionSkills',
    'sectionAwards',
    'sectionPreview',
    'sectionSettings'
]

const arrNavLinks = [
    { navId: 'navPersonal', sectionId: 'sectionPersonal' },
    { navId: 'navJobs',     sectionId: 'sectionJobs'     },
    { navId: 'navSkills',   sectionId: 'sectionSkills'   },
    { navId: 'navAwards',   sectionId: 'sectionAwards'   },
    { navId: 'navPreview',  sectionId: 'sectionPreview'  },
    { navId: 'navSettings', sectionId: 'sectionSettings' }
]

// Show one section and update sidebar active state
function showSection(strSectionId) {
    // Hide every section
    arrSections.forEach((strId) => {
        document.querySelector('#' + strId).style.display = 'none'
    })

    // Reveal the requested section
    document.querySelector('#' + strSectionId).style.display = 'block'

    // Update sidebar link active/inactive styles
    arrNavLinks.forEach((objLink) => {
        const elLink = document.querySelector('#' + objLink.navId)
        if(objLink.sectionId === strSectionId) {
            elLink.style.borderLeft = '3px solid #0dcaf0'
            elLink.classList.remove('text-white-50')
            elLink.classList.add('text-white')
        } else {
            elLink.style.borderLeft = '3px solid transparent'
            elLink.classList.remove('text-white')
            elLink.classList.add('text-white-50')
        }
    })

    // Rebuild the job-selection checklist whenever the user opens Resume Preview
    if(strSectionId === 'sectionPreview') {
        buildJobSelectList()
    }
}

// Bind each sidebar nav link to its section
arrNavLinks.forEach((objLink) => {
    document.querySelector('#' + objLink.navId).addEventListener('click',(e) => {
        e.preventDefault()
        showSection(objLink.sectionId)
    })
})

// =====================================================
// ATTRIBUTIONS MODAL
// =====================================================

document.querySelector('#btnAttributions').addEventListener('click',() => {
    const objModal = new bootstrap.Modal(document.querySelector('#modalAttributions'))
    objModal.show()
})

// =====================================================
// PERSONAL INFO
// =====================================================

// Populate all Personal Info form fields from saved state
function populatePersonalForm() {
    document.querySelector('#txtFirstName').value = objPersonal.firstName || ''
    document.querySelector('#txtLastName').value  = objPersonal.lastName  || ''
    document.querySelector('#txtEmail').value     = objPersonal.email     || ''
    document.querySelector('#txtPhone').value     = objPersonal.phone     || ''
    document.querySelector('#txtCity').value      = objPersonal.city      || ''
    document.querySelector('#cboState').value     = objPersonal.state     || 'TN'
    document.querySelector('#txtZip').value       = objPersonal.zip       || ''
    document.querySelector('#txtLinkedIn').value  = objPersonal.linkedin  || ''
    document.querySelector('#txtSummary').value   = objPersonal.summary   || ''
}

// Save Personal Info — validates fields then persists to the backend
document.querySelector('#btnSavePersonal').addEventListener('click',() => {
    let strFirstName = document.querySelector('#txtFirstName').value.trim()
    let strLastName  = document.querySelector('#txtLastName').value.trim()
    let strEmail     = document.querySelector('#txtEmail').value.trim()
    let strPhone     = document.querySelector('#txtPhone').value.trim()
    let strCity      = document.querySelector('#txtCity').value.trim()
    let strLinkedIn  = document.querySelector('#txtLinkedIn').value.trim()
    let strSummary   = document.querySelector('#txtSummary').value.trim()

    let blnError   = false
    let strMessage = ''

    if(strFirstName.length < 1) {
        blnError = true
        strMessage += '<p>First name is required.</p>'
    }
    if(strLastName.length < 1) {
        blnError = true
        strMessage += '<p>Last name is required.</p>'
    }
    if(strEmail.length < 1) {
        blnError = true
        strMessage += '<p>Email is required.</p>'
    }
    if(strEmail.length > 0 && !reEmail.test(strEmail)) {
        blnError = true
        strMessage += '<p>Email address format is invalid.</p>'
    }
    if(strPhone.length < 1) {
        blnError = true
        strMessage += '<p>Phone number is required.</p>'
    }
    if(strCity.length < 1) {
        blnError = true
        strMessage += '<p>City is required.</p>'
    }
    if(strLinkedIn.length < 1) {
        blnError = true
        strMessage += '<p>LinkedIn URL is required.</p>'
    }
    if(strSummary.length < 1) {
        blnError = true
        strMessage += '<p>Professional summary is required.</p>'
    }

    if(blnError != false) {
        Swal.fire({
            title: 'Please fix the following',
            html: strMessage,
            icon: 'error'
        })
    } else {
        objPersonal = {
            firstName: strFirstName,
            lastName:  strLastName,
            email:     strEmail,
            phone:     strPhone,
            city:      strCity,
            state:     document.querySelector('#cboState').value,
            zip:       document.querySelector('#txtZip').value.trim(),
            linkedin:  strLinkedIn,
            summary:   strSummary
        }

        fetch(`${strApiBase}/api/profile`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                name:     `${strFirstName} ${strLastName}`.trim(),
                email:    strEmail,
                phone:    strPhone,
                location: [strCity, objPersonal.state, objPersonal.zip].filter(Boolean).join(', '),
                link:     strLinkedIn,
                summary:  strSummary
            })
        })
        .then(result => {
            if(result.ok) {
                return result.json()
            } else {
                throw new Error(result.status)
            }
        })
        .then(arrProfileRows => {
            objPersonal = mapApiProfile(arrProfileRows[0] || {})
            Swal.fire({
                title: 'Saved!',
                text: 'Personal information has been saved.',
                icon: 'success'
            })
            showToast('Personal info saved!')
        })
        .catch(objError => {
            console.error('Profile save failed:', objError)
            Swal.fire({
                title: 'Save failed',
                text: objError.message,
                icon: 'error'
            })
        })
    }
})

// Request an AI-generated improvement to the professional summary
document.querySelector('#btnAISummary').addEventListener('click',() => {
    let strSummary = document.querySelector('#txtSummary').value.trim()

    let blnError   = false
    let strMessage = ''

    if(strSummary.length < 1) {
        blnError = true
        strMessage += 'Please write a draft summary first.'
    }

    if(blnError != false) {
        Swal.fire({
            title: 'Nothing to improve',
            text: strMessage,
            icon: 'warning'
        })
    } else {
        // Disable the button and show a loading state while waiting
        const elBtn       = document.querySelector('#btnAISummary')
        elBtn.textContent = 'Thinking…'
        elBtn.disabled    = true

        fetch(`${strApiBase}/api/ai/suggest-summary?text=${encodeURIComponent(strSummary)}`)
        .then(result => {
            if(result.ok) {
                return result.json()
            } else {
                return result.json().then(objError => { throw new Error(objError.error || `Server responded with status ${result.status}`) })
            }
        })
        .then(objData => {
            document.querySelector('#aiSummaryText').textContent  = objData.suggestion || objData.error
            document.querySelector('#aiSummaryBox').style.display = 'block'
        })
        .catch(objError => {
            console.error('AI summary request failed:', objError)
            Swal.fire({
                title: 'AI suggestion failed',
                text: objError.message,
                icon: 'error'
            })
        })
        .finally(() => {
            elBtn.innerHTML = '<i class="bi bi-magic me-1" aria-hidden="true"></i>AI Suggestion'
            elBtn.disabled  = false
        })
    }
})

// Copy the AI suggestion into the summary textarea and hide the suggestion box
document.querySelector('#btnAcceptSummary').addEventListener('click',() => {
    let strSuggestion = document.querySelector('#aiSummaryText').textContent
    document.querySelector('#txtSummary').value           = strSuggestion
    document.querySelector('#aiSummaryBox').style.display = 'none'
    showToast('AI suggestion applied!')
})

// =====================================================
// WORK EXPERIENCE
// =====================================================

// Re-render the staged responsibility tags below the input
function renderRespTags() {
    let strHTML = ''
    arrPendingResp.forEach((strResp, intIndex) => {
        strHTML += `
            <span class="badge bg-secondary me-1 mb-1" style="font-size:small;">
                ${escapeHtml(strResp)}
                <button
                    type="button"
                    class="btn-close btn-close-white ms-1"
                    style="font-size:medium;"
                    aria-label="Remove responsibility: ${escapeHtml(strResp)}"
                    onclick="removeResp(${intIndex})">
                </button>
            </span>`
    })
    document.querySelector('#respTagContainer').innerHTML = strHTML
}

// Remove a staged responsibility by its array index
function removeResp(intIndex) {
    arrPendingResp.splice(intIndex, 1)
    renderRespTags()
}

// Stage a new responsibility bullet when the Add button is clicked
document.querySelector('#btnAddResp').addEventListener('click',() => {
    let strResp = document.querySelector('#txtResponsibility').value.trim()

    let blnError   = false
    let strMessage = ''

    if(strResp.length < 1) {
        blnError = true
        strMessage += 'Please enter a responsibility before adding.'
    }

    if(blnError != false) {
        Swal.fire({
            title: 'Empty field',
            text: strMessage,
            icon: 'warning'
        })
    } else {
        arrPendingResp.push(strResp)
        document.querySelector('#txtResponsibility').value = ''
        renderRespTags()
    }
})

// Allow pressing Enter in the responsibility field to trigger Add
document.querySelector('#txtResponsibility').addEventListener('keydown',(e) => {
    if(e.key === 'Enter') {
        e.preventDefault()
        document.querySelector('#btnAddResp').click()
    }
})

// Request an AI-improved version of the current responsibility text
document.querySelector('#btnAIResp').addEventListener('click',() => {
    let strResp     = document.querySelector('#txtResponsibility').value.trim()
    let strJobTitle = document.querySelector('#txtJobTitle').value.trim()

    let blnError   = false
    let strMessage = ''

    if(strResp.length < 1 && strJobTitle.length < 1) {
        blnError = true
        strMessage += 'Enter a responsibility or job title first.'
    }

    if(blnError != false) {
        Swal.fire({
            title: 'Nothing to improve',
            text: strMessage,
            icon: 'warning'
        })
    } else {
        const elBtn    = document.querySelector('#btnAIResp')
        elBtn.disabled = true

        const strPayload = encodeURIComponent(strResp || `Responsibilities for ${strJobTitle}`)

        fetch(`${strApiBase}/api/ai/suggest-responsibility?text=${strPayload}&jobtitle=${encodeURIComponent(strJobTitle)}`)
        .then(result => {
            if(result.ok) {
                return result.json()
            } else {
                return result.json().then(objError => { throw new Error(objError.error || `Server responded with status ${result.status}`) })
            }
        })
        .then(objData => {
            document.querySelector('#aiRespText').textContent  = objData.suggestion || objData.error
            document.querySelector('#aiRespBox').style.display = 'block'
        })
        .catch(objError => {
            console.error('AI responsibility request failed:', objError)
            Swal.fire({
                title: 'AI suggestion failed',
                text: objError.message,
                icon: 'error'
            })
        })
        .finally(() => {
            elBtn.disabled = false
        })
    }
})

// Copy the AI responsibility suggestion into the input field
document.querySelector('#btnAcceptResp').addEventListener('click',() => {
    let strSuggestion = document.querySelector('#aiRespText').textContent
    document.querySelector('#txtResponsibility').value   = strSuggestion
    document.querySelector('#aiRespBox').style.display   = 'none'
})

// Disable / clear the End Date field while "I currently work here" is checked
document.querySelector('#chkCurrentJob').addEventListener('change',function() {
    document.querySelector('#txtEndDate').disabled = this.checked
    if(this.checked) {
        document.querySelector('#txtEndDate').value = ''
    }
})

// Save a completed job form to arrJobs and sync to the backend
document.querySelector('#btnSaveJob').addEventListener('click',() => {
    let strTitle   = document.querySelector('#txtJobTitle').value.trim()
    let strCompany = document.querySelector('#txtCompany').value.trim()
    let strStart   = document.querySelector('#txtStartDate').value
    let blnCurrent = document.querySelector('#chkCurrentJob').checked
    let strEnd     = blnCurrent ? 'Present' : document.querySelector('#txtEndDate').value

    let blnError   = false
    let strMessage = ''

    if(strTitle.length < 1) {
        blnError = true
        strMessage += '<p>Job title is required.</p>'
    }
    if(strCompany.length < 1) {
        blnError = true
        strMessage += '<p>Company name is required.</p>'
    }
    if(strStart && !reDate.test(strStart)) {
        blnError = true
        strMessage += '<p>Start date must be in MM/DD/YYYY format (e.g. 06/01/2023).</p>'
    }
    if(strEnd && strEnd !== 'Present' && !reDate.test(strEnd)) {
        blnError = true
        strMessage += '<p>End date must be in MM/DD/YYYY format or left blank for current jobs.</p>'
    }

    if(blnError != false) {
        Swal.fire({
            title: 'Please fix the following',
            html: strMessage,
            icon: 'error'
        })
    } else {
        fetch(`${strApiBase}/api/jobs`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                title:   strTitle,
                company: strCompany,
                dates:   `${strStart} \u2013 ${strEnd}`,
                bullets: arrPendingResp
            })
        })
        .then(result => {
            if(result.ok) {
                return result.json()
            } else {
                throw new Error(result.status)
            }
        })
        .then(objSavedJob => {
            arrJobs.push(mapApiJob(objSavedJob))

            // Reset the job form and staged responsibilities
            document.querySelector('#txtJobTitle').value      = ''
            document.querySelector('#txtCompany').value       = ''
            document.querySelector('#txtStartDate').value     = ''
            document.querySelector('#txtEndDate').value       = ''
            document.querySelector('#txtEndDate').disabled    = false
            document.querySelector('#chkCurrentJob').checked  = false
            arrPendingResp = []
            renderRespTags()
            document.querySelector('#aiRespBox').style.display = 'none'

            renderJobList()
            Swal.fire({
                title: 'Job Saved',
                text: 'The job has been added to your resume.',
                icon: 'success'
            })
            showToast('Job saved!')
        })
        .catch(objError => {
            console.error('Job save failed:', objError)
            Swal.fire({
                title: 'Save failed',
                text: objError.message,
                icon: 'error'
            })
        })
    }
})

// Render the list of saved jobs as cards below the Add Job form
function renderJobList() {
    const elJobList  = document.querySelector('#jobList')
    const elEmptyMsg = document.querySelector('#jobEmptyMsg')
    elJobList.innerHTML = ''

    if(arrJobs.length < 1) {
        elEmptyMsg.style.display = 'block'
        return
    }
    elEmptyMsg.style.display = 'none'

    arrJobs.forEach((objJob) => {
        const elCard = document.createElement('div')
        elCard.className = 'card col-12 shadow-sm mb-3'
        elCard.innerHTML = `
            <div class="card-body d-flex justify-content-between align-items-start">
                <div>
                    <p class="fw-bold mb-0">${escapeHtml(objJob.title)} — ${escapeHtml(objJob.company)}</p>
                    <p class="text-muted mb-0" style="font-size:small;">${objJob.start || '?'} – ${objJob.end || '?'}</p>
                    <p class="text-muted mb-0" style="font-size:small;">
                        ${objJob.responsibilities.length} responsibilit${objJob.responsibilities.length === 1 ? 'y' : 'ies'}
                    </p>
                </div>
                <button
                    class="btn btn-danger btn-sm"
                    type="button"
                    aria-label="Delete job: ${escapeHtml(objJob.title)} at ${escapeHtml(objJob.company)}"
                    onclick="deleteJob('${objJob.id}')">
                    <i class="bi bi-trash" aria-hidden="true"></i>
                </button>
            </div>`
        elJobList.appendChild(elCard)
    })
}

// Remove a job from the array and re-render the list
function deleteJob(strId) {
    fetch(`${strApiBase}/api/jobs/${encodeURIComponent(strId)}`, { method: 'DELETE' })
    .then(result => {
        if(result.ok) {
            return result.json()
        } else {
            throw new Error(result.status)
        }
    })
    .then(() => {
        arrJobs = arrJobs.filter((objJob) => String(objJob.id) !== String(strId))
        renderJobList()
        showToast('Job removed.')
    })
    .catch(objError => {
        console.error('Job delete failed:', objError)
        Swal.fire({
            title: 'Delete failed',
            text: objError.message,
            icon: 'error'
        })
    })
}

// =====================================================
// SKILLS & CERTIFICATIONS
// =====================================================

// Add a skill to arrSkills when the Add button is clicked
document.querySelector('#btnAddSkill').addEventListener('click',() => {
    let strName     = document.querySelector('#txtSkill').value.trim()
    let strCategory = document.querySelector('#cboSkillCategory').value

    let blnError   = false
    let strMessage = ''

    if(strName.length < 1) {
        blnError = true
        strMessage += 'Please enter a skill name.'
    }

    if(blnError != false) {
        Swal.fire({
            title: 'Empty field',
            text: strMessage,
            icon: 'warning'
        })
    } else {
        fetch(`${strApiBase}/api/skills`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name: strName, category: strCategory })
        })
        .then(result => {
            if(result.ok) {
                return result.json()
            } else {
                throw new Error(result.status)
            }
        })
        .then(objNewSkill => {
            arrSkills.push(objNewSkill)
            document.querySelector('#txtSkill').value = ''
            renderSkillList()
            showToast('Skill added!')
        })
        .catch(objError => {
            console.error('Skill save failed:', objError)
            Swal.fire({
                title: 'Save failed',
                text: objError.message,
                icon: 'error'
            })
        })
    }
})

// Allow pressing Enter in the skill field to trigger Add
document.querySelector('#txtSkill').addEventListener('keydown',(e) => {
    if(e.key === 'Enter') {
        e.preventDefault()
        document.querySelector('#btnAddSkill').click()
    }
})

// Render skills grouped by category
function renderSkillList() {
    const elSkillList = document.querySelector('#skillList')
    const elEmptyMsg  = document.querySelector('#skillEmptyMsg')
    elSkillList.innerHTML = ''

    if(arrSkills.length < 1) {
        elEmptyMsg.style.display = 'block'
        return
    }
    elEmptyMsg.style.display = 'none'

    // Group skills into an object keyed by category name
    const objGrouped = {}
    arrSkills.forEach((objSkill) => {
        if(!objGrouped[objSkill.category]) {
            objGrouped[objSkill.category] = []
        }
        objGrouped[objSkill.category].push(objSkill)
    })

    Object.keys(objGrouped).forEach((strCategory) => {
        const elLabel = document.createElement('p')
        elLabel.className      = 'fw-bold mb-1 mt-2'
        elLabel.style.fontSize = 'small'
        elLabel.textContent    = strCategory
        elSkillList.appendChild(elLabel)

        objGrouped[strCategory].forEach((objSkill) => {
            const elTag = document.createElement('span')
            elTag.className      = 'badge bg-primary me-1 mb-1'
            elTag.style.fontSize = 'medium'
            elTag.innerHTML = `
                ${escapeHtml(objSkill.name)}
                <button
                    type="button"
                    class="btn-close btn-close-white ms-1"
                    style="font-size:medium;"
                    aria-label="Remove skill: ${escapeHtml(objSkill.name)}"
                    onclick="deleteSkill('${objSkill.id}')">
                </button>`
            elSkillList.appendChild(elTag)
        })
    })
}

// Remove a skill from the array and re-render
function deleteSkill(strId) {
    fetch(`${strApiBase}/api/skills/${encodeURIComponent(strId)}`, { method: 'DELETE' })
    .then(result => {
        if(result.ok) {
            return result.json()
        } else {
            throw new Error(result.status)
        }
    })
    .then(() => {
        arrSkills = arrSkills.filter((objSkill) => String(objSkill.id) !== String(strId))
        renderSkillList()
    })
    .catch(objError => {
        console.error('Skill delete failed:', objError)
        Swal.fire({
            title: 'Delete failed',
            text: objError.message,
            icon: 'error'
        })
    })
}

// Add a certification to arrCerts
document.querySelector('#btnAddCert').addEventListener('click',() => {
    let strName   = document.querySelector('#txtCertName').value.trim()
    let strIssuer = document.querySelector('#txtCertIssuer').value.trim()
    let strDate   = document.querySelector('#txtCertDate').value

    let blnError   = false
    let strMessage = ''

    if(strName.length < 1) {
        blnError = true
        strMessage += 'Certification name is required.'
    }

    if(blnError != false) {
        Swal.fire({
            title: 'Empty field',
            text: strMessage,
            icon: 'warning'
        })
    } else {
        fetch(`${strApiBase}/api/certifications`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name: strName, issuer: strIssuer, year: strDate })
        })
        .then(result => {
            if(result.ok) {
                return result.json()
            } else {
                throw new Error(result.status)
            }
        })
        .then(objNewCert => {
            arrCerts.push(mapApiCert(objNewCert))
            document.querySelector('#txtCertName').value   = ''
            document.querySelector('#txtCertIssuer').value = ''
            document.querySelector('#txtCertDate').value   = ''
            renderCertList()
            showToast('Certification added!')
        })
        .catch(objError => {
            console.error('Certification save failed:', objError)
            Swal.fire({
                title: 'Save failed',
                text: objError.message,
                icon: 'error'
            })
        })
    }
})

// Render saved certifications as small cards
function renderCertList() {
    const elCertList = document.querySelector('#certList')
    const elEmptyMsg = document.querySelector('#certEmptyMsg')
    elCertList.innerHTML = ''

    if(arrCerts.length < 1) {
        elEmptyMsg.style.display = 'block'
        return
    }
    elEmptyMsg.style.display = 'none'

    arrCerts.forEach((objCert) => {
        const elCard = document.createElement('div')
        elCard.className = 'card col-12 shadow-sm mb-2'
        elCard.innerHTML = `
            <div class="card-body d-flex justify-content-between align-items-center py-2">
                <div>
                    <p class="fw-bold mb-0">${escapeHtml(objCert.name)}</p>
                    <p class="text-muted mb-0" style="font-size:small;">
                        ${escapeHtml(objCert.issuer || '')}${objCert.date ? ' · ' + objCert.date : ''}
                    </p>
                </div>
                <button
                    class="btn btn-danger btn-sm"
                    type="button"
                    aria-label="Remove certification: ${escapeHtml(objCert.name)}"
                    onclick="deleteCert('${objCert.id}')">
                    <i class="bi bi-trash" aria-hidden="true"></i>
                </button>
            </div>`
        elCertList.appendChild(elCard)
    })
}

// Remove a certification from the array and re-render
function deleteCert(strId) {
    fetch(`${strApiBase}/api/certifications/${encodeURIComponent(strId)}`, { method: 'DELETE' })
    .then(result => {
        if(result.ok) {
            return result.json()
        } else {
            throw new Error(result.status)
        }
    })
    .then(() => {
        arrCerts = arrCerts.filter((objCert) => String(objCert.id) !== String(strId))
        renderCertList()
    })
    .catch(objError => {
        console.error('Certification delete failed:', objError)
        Swal.fire({
            title: 'Delete failed',
            text: objError.message,
            icon: 'error'
        })
    })
}

// =====================================================
// AWARDS
// =====================================================

// Add an award to arrAwards
document.querySelector('#btnAddAward').addEventListener('click',() => {
    let strName = document.querySelector('#txtAwardName').value.trim()
    let strOrg  = document.querySelector('#txtAwardOrg').value.trim()
    let strDate = document.querySelector('#txtAwardDate').value
    let strDesc = document.querySelector('#txtAwardDesc').value.trim()

    let blnError   = false
    let strMessage = ''

    if(strName.length < 1) {
        blnError = true
        strMessage += 'Award name is required.'
    }

    if(blnError != false) {
        Swal.fire({
            title: 'Empty field',
            text: strMessage,
            icon: 'warning'
        })
    } else {
        fetch(`${strApiBase}/api/awards`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name: strName, org: strOrg, year: strDate, description: strDesc })
        })
        .then(result => {
            if(result.ok) {
                return result.json()
            } else {
                throw new Error(result.status)
            }
        })
        .then(objNewAward => {
            arrAwards.push(mapApiAward(objNewAward))
            document.querySelector('#txtAwardName').value = ''
            document.querySelector('#txtAwardOrg').value  = ''
            document.querySelector('#txtAwardDate').value = ''
            document.querySelector('#txtAwardDesc').value = ''
            renderAwardList()
            showToast('Award added!')
        })
        .catch(objError => {
            console.error('Award save failed:', objError)
            Swal.fire({
                title: 'Save failed',
                text: objError.message,
                icon: 'error'
            })
        })
    }
})

// Render saved awards as small cards
function renderAwardList() {
    const elAwardList = document.querySelector('#awardList')
    const elEmptyMsg  = document.querySelector('#awardEmptyMsg')
    elAwardList.innerHTML = ''

    if(arrAwards.length < 1) {
        elEmptyMsg.style.display = 'block'
        return
    }
    elEmptyMsg.style.display = 'none'

    arrAwards.forEach((objAward) => {
        const elCard = document.createElement('div')
        elCard.className = 'card col-12 shadow-sm mb-3'
        elCard.innerHTML = `
            <div class="card-body d-flex justify-content-between align-items-start">
                <div>
                    <p class="fw-bold mb-0">${escapeHtml(objAward.name)}</p>
                    <p class="text-muted mb-0" style="font-size:small;">
                        ${escapeHtml(objAward.org || '')}${objAward.date ? ' · ' + objAward.date : ''}
                    </p>
                    ${objAward.desc
                        ? `<p class="text-muted mb-0" style="font-size:small;">${escapeHtml(objAward.desc)}</p>`
                        : ''}
                </div>
                <button
                    class="btn btn-danger btn-sm"
                    type="button"
                    aria-label="Remove award: ${escapeHtml(objAward.name)}"
                    onclick="deleteAward('${objAward.id}')">
                    <i class="bi bi-trash" aria-hidden="true"></i>
                </button>
            </div>`
        elAwardList.appendChild(elCard)
    })
}

// Remove an award from the array and re-render
function deleteAward(strId) {
    fetch(`${strApiBase}/api/awards/${encodeURIComponent(strId)}`, { method: 'DELETE' })
    .then(result => {
        if(result.ok) {
            return result.json()
        } else {
            throw new Error(result.status)
        }
    })
    .then(() => {
        arrAwards = arrAwards.filter((objAward) => String(objAward.id) !== String(strId))
        renderAwardList()
    })
    .catch(objError => {
        console.error('Award delete failed:', objError)
        Swal.fire({
            title: 'Delete failed',
            text: objError.message,
            icon: 'error'
        })
    })
}

// =====================================================
// RESUME PREVIEW
// =====================================================

// Build the job + responsibility checkboxes so the user can choose what to include
function buildJobSelectList() {
    const elContainer = document.querySelector('#jobSelectList')
    elContainer.innerHTML = ''

    if(arrJobs.length < 1) {
        elContainer.innerHTML = '<p class="text-muted fst-italic small">Add jobs first to select them.</p>'
        return
    }

    arrJobs.forEach((objJob) => {
        const elWrapper = document.createElement('div')
        elWrapper.className = 'mb-3'
        elWrapper.innerHTML = `<p class="fw-bold mb-1">${escapeHtml(objJob.title)} — ${escapeHtml(objJob.company)}</p>`

        objJob.responsibilities.forEach((strResp, intIndex) => {
            const strCheckId = `resp_${objJob.id}_${intIndex}`
            elWrapper.innerHTML += `
                <div class="form-check ms-3">
                    <input
                        class="form-check-input"
                        type="checkbox"
                        value="${intIndex}"
                        id="${strCheckId}"
                        data-jobid="${objJob.id}"
                        checked
                        aria-label="${escapeHtml(strResp)}">
                    <label class="form-check-label" for="${strCheckId}" style="font-size:small;">
                        ${escapeHtml(strResp)}
                    </label>
                </div>`
        })

        elContainer.appendChild(elWrapper)
    })
}

// Assemble the resume HTML from saved data and selected responsibilities
document.querySelector('#btnBuildResume').addEventListener('click',() => {
    const elPreview = document.querySelector('#resumePreview')
    let strHTML     = ''

    // Collect which responsibility indices are checked, keyed by job ID
    const objSelectedResps = {}
    document.querySelectorAll('[data-jobid]').forEach((elCheckbox) => {
        let strJobId = elCheckbox.getAttribute('data-jobid')
        if(!objSelectedResps[strJobId]) {
            objSelectedResps[strJobId] = []
        }
        if(elCheckbox.checked) {
            objSelectedResps[strJobId].push(parseInt(elCheckbox.value))
        }
    })

    // Header section
    let strFullName     = [objPersonal.firstName, objPersonal.lastName].filter(Boolean).join(' ') || 'Your Name'
    let strLocation     = [objPersonal.city, objPersonal.state, objPersonal.zip].filter(Boolean).join(', ')
    let arrContactParts = [objPersonal.email, objPersonal.phone, strLocation, objPersonal.linkedin].filter(Boolean)

    strHTML += `
        <h2 class="fw-bold mb-0" style="font-size:x-large;">${escapeHtml(strFullName)}</h2>
        <p class="text-muted mb-0" style="font-size:small;">
            ${arrContactParts.map(escapeHtml).join(' &nbsp;|&nbsp; ')}
        </p>
        <hr />`

    // Professional Summary
    if(objPersonal.summary) {
        strHTML += `
            <p class="text-uppercase fw-bold mb-1" style="font-size:0.7rem; letter-spacing:0.1em; color:#0dcaf0;">Summary</p>
            <p style="font-size:small;">${escapeHtml(objPersonal.summary)}</p>`
    }

    // Work Experience — only include jobs with at least one selected responsibility
    const arrJobsWithContent = arrJobs.filter((objJob) => {
        let arrSelected = objSelectedResps[objJob.id] || []
        return arrSelected.length > 0
    })

    if(arrJobsWithContent.length > 0) {
        strHTML += `<p class="text-uppercase fw-bold mb-1 mt-3" style="font-size:0.7rem; letter-spacing:0.1em; color:#0dcaf0;">Work Experience</p>`

        arrJobsWithContent.forEach((objJob) => {
            let arrSelected = (objSelectedResps[objJob.id] || [])
                .map((intI) => objJob.responsibilities[intI])
                .filter(Boolean)

            strHTML += `
                <div class="mb-2">
                    <p class="fw-bold mb-0">${escapeHtml(objJob.title)}</p>
                    <p class="text-muted mb-0" style="font-size:small;">
                        ${escapeHtml(objJob.company)} &nbsp;·&nbsp; ${objJob.start || '?'} – ${objJob.end || '?'}
                    </p>
                    ${arrSelected.length > 0
                        ? '<ul style="font-size:small;">' + arrSelected.map((strR) => `<li>${escapeHtml(strR)}</li>`).join('') + '</ul>'
                        : ''}
                </div>`
        })
    }

    // Skills grouped by category
    if(arrSkills.length > 0) {
        strHTML += `<p class="text-uppercase fw-bold mb-1 mt-3" style="font-size:0.7rem; letter-spacing:0.1em; color:#0dcaf0;">Skills</p>`

        const objGrouped = {}
        arrSkills.forEach((objSkill) => {
            if(!objGrouped[objSkill.category]) { objGrouped[objSkill.category] = [] }
            objGrouped[objSkill.category].push(objSkill.name)
        })

        Object.keys(objGrouped).forEach((strCat) => {
            strHTML += `<p style="font-size:small; margin:0.2rem 0;">
                <strong>${escapeHtml(strCat)}:</strong> ${objGrouped[strCat].map(escapeHtml).join(', ')}
            </p>`
        })
    }

    // Certifications
    if(arrCerts.length > 0) {
        strHTML += `<p class="text-uppercase fw-bold mb-1 mt-3" style="font-size:0.7rem; letter-spacing:0.1em; color:#0dcaf0;">Certifications</p>`

        arrCerts.forEach((objCert) => {
            strHTML += `<p style="font-size:small; margin:0.2rem 0;">
                <strong>${escapeHtml(objCert.name)}</strong>
                ${objCert.issuer ? ' &nbsp;·&nbsp; ' + escapeHtml(objCert.issuer) : ''}
                ${objCert.date   ? ' &nbsp;·&nbsp; ' + objCert.date : ''}
            </p>`
        })
    }

    // Awards & Honors
    if(arrAwards.length > 0) {
        strHTML += `<p class="text-uppercase fw-bold mb-1 mt-3" style="font-size:0.7rem; letter-spacing:0.1em; color:#0dcaf0;">Awards and Honors</p>`

        arrAwards.forEach((objAward) => {
            strHTML += `<p style="font-size:small; margin:0.2rem 0;">
                <strong>${escapeHtml(objAward.name)}</strong>
                ${objAward.org  ? ' &nbsp;·&nbsp; ' + escapeHtml(objAward.org) : ''}
                ${objAward.date ? ' &nbsp;·&nbsp; ' + objAward.date : ''}
                ${objAward.desc ? '<br><span class="text-muted">' + escapeHtml(objAward.desc) + '</span>' : ''}
            </p>`
        })
    }

    elPreview.innerHTML = strHTML
    showToast('Resume preview built!')
})

document.querySelector('#printBtn').addEventListener('click', () => {
    const objMain = document.querySelector('#mainContent')
    // Remove the left margin offset before printing
    objMain.style.marginLeft = '0'
    window.print()
    // Restore after print dialog closes
    objMain.style.marginLeft = 'auto'
})

// =====================================================
// SETTINGS
// =====================================================

// Save the Gemini API key to the backend
document.querySelector('#btnSaveKey').addEventListener('click',() => {
    let strKey = document.querySelector('#txtApiKey').value.trim()

    let blnError   = false
    let strMessage = ''

    if(strKey.length < 1) {
        blnError = true
        strMessage += 'Please enter an API key.'
    }

    if(blnError != false) {
        Swal.fire({
            title: 'Empty field',
            text: strMessage,
            icon: 'warning'
        })
    } else {
        fetch(`${strApiBase}/api/profile`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ apiKey: strKey })
        })
        .then(result => {
            if(result.ok) {
                return result.json()
            } else {
                throw new Error(result.status)
            }
        })
        .then(arrProfileRows => {
            objPersonal = mapApiProfile(arrProfileRows[0] || {})
            document.querySelector('#apiKeyStatus').innerHTML =
                '<span class="text-success" style="font-size:small;"><i class="bi bi-check-circle me-1" aria-hidden="true"></i>API key saved.</span>'
            showToast('API key saved!')
        })
        .catch(objError => {
            console.error('Could not save API key to backend:', objError)
            Swal.fire({
                title: 'Save failed',
                text: objError.message,
                icon: 'error'
            })
        })
    }
})

// Clear all resume data from SQLite after user confirms
document.querySelector('#btnClearData').addEventListener('click',async() => {
    const objResult = await Swal.fire({
        title:              'Are you sure?',
        text:               'This will delete all saved resume data and cannot be undone.',
        icon:               'warning',
        showCancelButton:   true,
        confirmButtonColor: '#dc3545',
        confirmButtonText:  'Yes, clear everything'
    })

    if(objResult.isConfirmed) {
        fetch(`${strApiBase}/api/data`, { method: 'DELETE' })
        .then(result => {
            if(result.ok) {
                return result.json()
            } else {
                throw new Error(result.status)
            }
        })
        .then(() => {
            objPersonal    = {}
            arrJobs        = []
            arrSkills      = []
            arrCerts       = []
            arrAwards      = []
            arrPendingResp = []

            populatePersonalForm()
            renderJobList()
            renderSkillList()
            renderCertList()
            renderAwardList()
            showToast('All data cleared.')
        })
        .catch(objError => {
            console.error('Clear data failed:', objError)
            Swal.fire({
                title: 'Clear failed',
                text: objError.message,
                icon: 'error'
            })
        })
    }
})

// =====================================================
// INIT — runs once on page load
// =====================================================
async function initApp() {
    try {
        await loadState()
    } catch(objError) {
        console.error('Initial data load failed:', objError)
        Swal.fire({
            title: 'Could not load saved data',
            text:  'Make sure the Node server is running, then refresh the page.',
            icon:  'error'
        })
    }

    populatePersonalForm()
    renderJobList()
    renderSkillList()
    renderCertList()
    renderAwardList()
}

initApp()