import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
console.log("API Base URL:", baseURL);

export const api = axios.create({
  baseURL: baseURL,
  withCredentials: true, // Send cookies with requests (important for session-based auth)
});

// Optional: Add interceptors for request/response logging or error handling
api.interceptors.request.use(request => {
  // console.log('Starting Request:', request.method?.toUpperCase(), request.url);
  return request;
});

api.interceptors.response.use(response => {
  // console.log('Response:', response.status, response.config.url);
  return response;
}, error => {
   console.error('API Error:', error.response?.status, error.config?.url, error.response?.data?.message || error.message);
  // Handle specific errors globally if needed (e.g., 401 Unauthorized -> logout)
  if (error.response?.status === 401) {
     console.warn("Received 401 Unauthorized from API. Logging out.");
     // Avoid direct store manipulation here if possible, maybe dispatch event or redirect
     // import { useUserStore } from '../store/userStore'; // Can cause circular dependency issues
     // useUserStore.getState().logoutUser(); // Trigger logout
     window.location.href = '/login?session_expired=true'; // Force redirect
  }
  return Promise.reject(error);
});
