import React, { useState, useRef, useEffect } from 'react';
import { useGameStore } from '@/store/gameStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessagePayload } from '@/types';

interface ChatBoxProps {
    gameId: string;
    userId?: string;
    userName?: string;
    sendMessage: (message: MessagePayload) => void;
}

export const ChatBox: React.FC<ChatBoxProps> = ({ gameId, userId, userName, sendMessage }) => {
    const [message, setMessage] = useState('');
    const chatMessages = useGameStore((state) => state.chatMessages);
    const scrollAreaRef = useRef<HTMLDivElement>(null);

    const handleSendMessage = (e?: React.FormEvent) => {
        e?.preventDefault(); // Prevent form submission if used in a form
        if (message.trim() && userId && userName && gameId) {
             console.log(`Sending chat: "${message}" from ${userName}`);
            sendMessage({
                type: 'CHAT_MESSAGE',
                payload: {
                    gameId: gameId,
                    userId: userId,
                    name: userName,
                    message: message.trim(),
                }
            });
            setMessage(''); // Clear input after sending
        } else {
             console.warn("Cannot send chat: Message empty or user info missing.");
        }
    };

     // Auto-scroll to bottom when new messages arrive
     useEffect(() => {
         if (scrollAreaRef.current) {
             // Find the viewport element within the ScrollArea structure
             const viewport = scrollAreaRef.current.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]');
             if (viewport) {
                  viewport.scrollTop = viewport.scrollHeight;
             }
         }
     }, [chatMessages]); // Dependency on messages array

    return (
        <div className="flex flex-col h-full">
             <ScrollArea className="flex-grow p-4 border rounded-md mb-2" ref={scrollAreaRef}>
                <div className="space-y-2">
                    {chatMessages.length === 0 && (
                        <p className="text-center text-sm text-muted-foreground">No messages yet.</p>
                    )}
                    {chatMessages.map((msg, index) => (
                        <div key={index} className={`flex ${msg.userId === userId ? 'justify-end' : 'justify-start'}`}>
                             <div className={`p-2 rounded-lg max-w-[75%] ${msg.userId === userId ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`}>
                                <p className="text-xs font-semibold mb-1">{msg.name}{msg.userId === userId ? ' (You)' : ''}</p>
                                <p className="text-sm break-words">{msg.message}</p>
                             </div>
                        </div>
                    ))}
                </div>
            </ScrollArea>
            <form onSubmit={handleSendMessage} className="flex space-x-2">
                <Input
                    type="text"
                    placeholder="Type your message..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    disabled={!userId} // Disable if not logged in
                    className="flex-grow"
                />
                <Button type="submit" disabled={!message.trim() || !userId}>
                    Send
                </Button>
            </form>
        </div>
    );
};