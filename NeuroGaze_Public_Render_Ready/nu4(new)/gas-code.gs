/**
 * Google Apps Script (GAS) Web App Endpoint for NeuroGaze Assessment JSON Uploads.
 * 
 * Instructions:
 * 1. Open https://script.google.com
 * 2. Click "New Project"
 * 3. Replace all default code in "Code.gs" with this script.
 * 4. Configure the TARGET_FOLDER_ID below with the ID of your Google Drive folder.
 * 5. Configure the SECURITY_TOKEN to match the one sent by the neurogaze client (default: "NEUROGAZE_SECURE_TOKEN_2026").
 * 6. Save (Ctrl+S) and deploy:
 *    - Click "Deploy" > "New deployment"
 *    - Select "Web app" (gear icon)
 *    - Execute as: "Me" (your email)
 *    - Who has access: "Anyone" (Required for cross-origin client POST payloads)
 *    - Click "Deploy", authorize the scopes requested, and copy the Web App "URL" (ending with "/exec").
 * 7. Paste that URL into the NeuroGaze results page modal.
 * 
 * Target Shared Google Drive Folder ID: 1CLhA5AbAZigJlBaLDS0ASOgI9nPAR_sY
 */

const TARGET_FOLDER_ID = "1CLhA5AbAZigJlBaLDS0ASOgI9nPAR_sY";
const SECURITY_TOKEN = "NEUROGAZE_SECURE_TOKEN_2026"; 

/**
 * Handle HTTP POST requests coming from the NeuroGaze application proxy.
 * Validates metadata, security tokens, and persists the payload as a JSON file in Google Drive.
 */
function doPost(e) {
  // Setup CORS Headers for maximum compatibility
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  try {
    // 1. Check if postData exists
    if (!e || !e.postData || !e.postData.contents) {
      return logAndReturnError("Missing or empty request body.", 400, headers);
    }

    // 2. Parse the JSON details
    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseError) {
      return logAndReturnError("Malformed JSON. Could not parse request body.", 400, headers);
    }

    // 3. Security Token Validation
    if (payload.securityToken !== SECURITY_TOKEN) {
      return logAndReturnError("Authorization failed. Invalid or missing securityToken.", 401, headers);
    }

    // 4. Data Payload Validation
    if (!payload.participant || !payload.results) {
      return logAndReturnError("Validation failed. Missing required fields: 'participant' and/or 'results'.", 400, headers);
    }

    const participantId = payload.participant.id || "unknown_participant";
    
    // 5. Connect and Locate the target folder
    let folder;
    try {
      folder = DriveApp.getFolderById(TARGET_FOLDER_ID);
    } catch (folderError) {
      return logAndReturnError("Folder Access Error: Could not locate or access the Google Drive Folder with ID '" + TARGET_FOLDER_ID + "'. Make sure the script owner has edit/manage access.", 500, headers);
    }

    // 6. Generate chronological timestamp & custom file name
    const now = new Date();
    const pad = (num) => String(num).padStart(2, '0');
    const timestampStr = now.getFullYear() + "-" + 
                         pad(now.getMonth() + 1) + "-" + 
                         pad(now.getDate()) + "_" + 
                         pad(now.getHours()) + "-" + 
                         pad(now.getMinutes()) + "-" + 
                         pad(now.getSeconds());
                         
    const fileName = "StudyResult_" + participantId + "_" + timestampStr + ".json";

    // 7. Save structural file directly into Target Folder
    const jsonString = JSON.stringify(payload, null, 2);
    const newFile = folder.createFile(fileName, jsonString, "application/json");

    // 8. Generate success response payload
    const responsePayload = {
      status: "success",
      message: "Study result successfully saved to Google Drive shared folder.",
      file: {
        id: newFile.getId(),
        name: newFile.getName(),
        url: newFile.getUrl(),
        downloadUrl: newFile.getDownloadUrl(),
        createdTime: now.toISOString()
      },
      folder: {
        id: TARGET_FOLDER_ID,
        name: folder.getName()
      }
    };

    return ContentService.createTextOutput(JSON.stringify(responsePayload))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (globalError) {
    return logAndReturnError("Internal Server Error: " + globalError.toString(), 500, headers);
  }
}

/**
 * Handle HTTP OPTIONS requests for browser safety preflights
 */
function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Common formatting for logging and standardizing errors returned to client
 */
function logAndReturnError(errorMessage, statusCode, headers) {
  const errorObj = {
    status: "error",
    code: statusCode,
    message: errorMessage,
    timestamp: new Date().toISOString()
  };
  return ContentService.createTextOutput(JSON.stringify(errorObj))
    .setMimeType(ContentService.MimeType.JSON);
}
