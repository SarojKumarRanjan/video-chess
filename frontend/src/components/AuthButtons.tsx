import React from 'react';
import { Button } from '@/components/ui/button';
import { useUserStore } from '@/store/userStore';
import { api } from '@/lib/api';
import { useToast } from "@/components/ui/use-toast"; // Shadcn toast

export const AuthButtons: React.FC = () => {
    const { setAuthenticatedUser } = useUserStore();
    const { toast } = useToast();

    const handleGoogleLogin = () => {
        console.log("Initiating Google Login...");
        // Redirect to backend Google auth endpoint
        window.location.href = `${import.meta.env.VITE_API_URL}/auth/google`;
    };

    const handleGuestLogin = async () => {
        console.log("Attempting Guest Login...");
        try {
            const response = await api.post('/auth/guest');
            const { user, wsToken } = response.data;
            if (user && wsToken) {
                console.log("Guest login successful:", user.name);
                 setAuthenticatedUser(user, wsToken);
                 toast({ title: "Logged in as Guest", description: `Welcome, ${user.name}!` });
                 // Navigation will be handled by App.tsx effect
            } else {
                 throw new Error("Guest login response missing user or token.");
            }
        } catch (error: any) {
            console.error("Guest Login Failed:", error);
             toast({
                 title: "Guest Login Failed",
                 description: error.response?.data?.message || error.message || "Could not log in as guest.",
                 variant: "destructive",
             });
        }
    };

    return (
        <div className="flex flex-col space-y-4">
            <Button onClick={handleGoogleLogin} variant="outline" className="w-full">
                {/* Add Google Icon here if desired */}
                <span className="ml-2">Login with Google</span>
            </Button>
            <Button onClick={handleGuestLogin} variant="secondary" className="w-full">
                Play as Guest
            </Button>
        </div>
    );
};