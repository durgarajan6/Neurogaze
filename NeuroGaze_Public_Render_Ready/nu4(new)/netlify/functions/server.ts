import app from '../api/index';
import serverless from 'serverless-http';

export const handler = serverless(app);
