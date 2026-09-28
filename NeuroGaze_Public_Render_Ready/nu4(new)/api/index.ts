import express from 'express';
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Debug environment variables presence (not values)
const getEnvStatus = () => ({
    hasCloudName: !!process.env.CLOUDINARY_CLOUD_NAME,
    hasApiKey: !!process.env.CLOUDINARY_API_KEY,
    hasApiSecret: !!process.env.CLOUDINARY_API_SECRET,
    nodeEnv: process.env.NODE_ENV,
    keys: Object.keys(process.env).filter(k => k.includes('CLOUD'))
});

console.log('Environment Probe:', getEnvStatus());

// Configure Cloudinary helper
const getCloudinary = () => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
        const status = getEnvStatus();
        throw new Error(`Cloudinary config missing. Vars: ${JSON.stringify(status.keys)}. Values present: Name=${!!cloudName}, Key=${!!apiKey}, Secret=${!!apiSecret}`);
    }

    cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true
    });
    return cloudinary;
};

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Middleware for parsing JSON
app.use(express.json({ limit: '50mb' }));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- API Routes ---

app.get('/api/health', (req, res) => {
  const mask = (str: string | undefined) => str ? `${str.substring(0, 3)}...${str.substring(str.length - 3)}` : 'MISSING';
  const status = getEnvStatus();
  
  res.json({ 
    status: 'ok', 
    environment: process.env.NODE_ENV || 'development',
    probe: status,
    config: {
        cloudName: mask(process.env.CLOUDINARY_CLOUD_NAME),
        apiKey: mask(process.env.CLOUDINARY_API_KEY),
        apiSecret: mask(process.env.CLOUDINARY_API_SECRET)
    }
  });
});

app.get('/api/test-cloudinary', async (req, res) => {
    try {
        const cloud = getCloudinary();
        const result = await cloud.api.ping();
        
        res.json({ 
            status: 'connected', 
            details: 'Cloudinary ping successful',
            cloudName: process.env.CLOUDINARY_CLOUD_NAME,
            result 
        });
    } catch (e: any) {
        console.error('Test Connection Failed:', e);
        res.status(500).json({ 
            status: 'error', 
            message: e?.message || 'Unknown connection error',
            cloudinary_error: e?.error || e,
            config: { 
                cloud: !!process.env.CLOUDINARY_CLOUD_NAME, 
                key: !!process.env.CLOUDINARY_API_KEY, 
                secret: !!process.env.CLOUDINARY_API_SECRET 
            },
            stack: process.env.NODE_ENV === 'production' ? null : e.stack
        });
    }
});

app.get('/api/cloudinary-images', async (req, res) => {
  try {
    const cloud = getCloudinary();
    const folder = req.query.folder as string;
    if (!folder) {
      return res.status(400).json({ error: 'Folder parameter is required' });
    }

    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    
    try {
        const result = await cloud.api.resources({
            type: 'upload',
            prefix: prefix,
            max_results: 100
        });

        if (result.resources && result.resources.length > 0) {
            return res.json({ images: result.resources });
        }
    } catch (apiErr: any) {
        console.warn('Admin API failed, trying Search API...', apiErr.message);
    }

    const searchResult = await cloud.search
      .expression(`folder:"${folder}"`)
      .sort_by('created_at', 'desc')
      .max_results(50)
      .execute();

    res.json({ images: searchResult.resources });
  } catch (error: any) {
    console.error('Cloudinary Error:', error);
    res.status(500).json({ 
      error: 'Cloudinary operation failed',
      details: error?.error?.message || error?.message || JSON.stringify(error),
      code: error?.http_code || 500
    });
  }
});

app.get('/api/cloudinary-folders', async (req, res) => {
  try {
    const cloud = getCloudinary();
    // Get root folders
    const result = await cloud.api.root_folders();
    res.json({ folders: result.folders });
  } catch (error: any) {
    console.error('Cloudinary Folders Error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch folders',
      details: error?.error?.message || error?.message || JSON.stringify(error)
    });
  }
});

app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided' });
  }

  try {
    const cloud = getCloudinary();
    const folderName = req.body.folder || 'neurogaze_study';
    const b64 = Buffer.from(req.file.buffer).toString('base64');
    let dataURI = "data:" + req.file.mimetype + ";base64," + b64;
    
    const result = await cloud.uploader.upload(dataURI, {
      folder: folderName,
    });
    
    res.json({ url: result.secure_url, public_id: result.public_id });
  } catch (error: any) {
    console.error('Cloudinary upload error:', error);
    res.status(500).json({ error: 'Failed to upload image', details: error.message });
  }
});

app.post('/api/save-to-gas', async (req, res) => {
  const { payload } = req.body;
  
  // Use server-side environment variable to protect the URL from being exposed to the browser
  let gasUrl = (process.env.GAS_WEB_APP_URL || req.body.gasUrl || "").trim();

  if (!gasUrl) {
    return res.status(400).json({ 
      error: 'Google Apps Script Web App URL is not configured on the server. Please define GAS_WEB_APP_URL in your .env configuration.' 
    });
  }
  if (!payload) {
    return res.status(400).json({ error: 'JSON payload is required.' });
  }

  try {
    const response = await fetch(gasUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      data = { rawText: text };
    }

    if (response.ok) {
      res.json(data);
    } else {
      res.status(response.status).json({
        error: 'Google Apps Script endpoint returned an error status',
        status: response.status,
        details: data
      });
    }
  } catch (error: any) {
    console.error('GAS dispatch error:', error);
    res.status(500).json({
      error: 'Failed to communicate with Google Apps Script Web App',
      details: error.message
    });
  }
});

// Route to download line-by-line codebase explanation Word document
app.get('/api/download-code-doc', (req, res) => {
  const docPath = path.join(process.cwd(), 'public', 'NeuroGaze_Codebase_Line_By_Line_Explanation.docx');
  const rootPath = path.join(process.cwd(), 'NeuroGaze_Codebase_Line_By_Line_Explanation.docx');
  const targetPath = fs.existsSync(docPath) ? docPath : rootPath;

  if (fs.existsSync(targetPath)) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="NeuroGaze_Codebase_Line_By_Line_Explanation.docx"');
    res.sendFile(targetPath);
  } else {
    res.status(404).json({ error: 'Documentation file not found' });
  }
});

// --- Frontend Serving (For local dev only) ---

async function setupFrontend() {
    if (process.env.VERCEL || process.env.NETLIFY) return;

    if (process.env.NODE_ENV !== 'production') {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      
      app.get('*', (req, res) => {
        if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not Found' });
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
}

setupFrontend();

// Only listen locally, Vercel exports the handler
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
}

export default app;
