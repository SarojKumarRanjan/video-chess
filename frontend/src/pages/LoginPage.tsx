import React from 'react';
import { AuthButtons } from '@/components/AuthButtons'; 
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const LoginPage: React.FC = () => {
    return (
        <div className="flex items-center justify-center min-h-screen">
             <Card className="w-[350px]">
                 <CardHeader>
                     <CardTitle>Welcome to Chess Online</CardTitle>
                     <CardDescription>Play chess with friends or find a match.</CardDescription>
                 </CardHeader>
                 <CardContent>
                     <AuthButtons />
                 </CardContent>
             </Card>
        </div>
    );
};

export default LoginPage;