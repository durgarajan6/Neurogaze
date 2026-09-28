import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { EyeTrackingProvider } from './context/EyeTrackingContext';
import Welcome from './pages/Welcome';
import ImageUpload from './pages/ImageUpload';
import Calibration from './pages/Calibration';
import Study from './pages/Study';
import Results from './pages/Results';

const App: React.FC = () => {
  return (
    <HashRouter>
      <EyeTrackingProvider>
        <Routes>
          <Route path="/" element={<Welcome />} />
          <Route path="/upload" element={<ImageUpload />} />
          <Route path="/calibration" element={<Calibration />} />
          <Route path="/study" element={<Study />} />
          <Route path="/results" element={<Results />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </EyeTrackingProvider>
    </HashRouter>
  );
};

export default App;