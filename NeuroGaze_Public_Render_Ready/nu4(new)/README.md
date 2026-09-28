<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/0c922def-bad7-4098-9108-4238b006d98b

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`


## Public deployment
This project is configured for Render as a Node web service. Build: `npm ci && npm run build`. Start: `npm start`. Set Cloudinary/GAS environment variables in Render if those features are required. The separate ML API is not included in this ZIP and must be deployed separately if ML correction is required.
