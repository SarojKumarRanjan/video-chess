import React, { useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useGameStore } from '@/store/gameStore';

interface VideoCallProps {
    onStartCall: () => void;
    onEndCall: () => void;
}

export const VideoCall: React.FC<VideoCallProps> = ({ onStartCall, onEndCall }) => {
    const localStream = useGameStore((state) => state.localStream);
    const remoteStream = useGameStore((state) => state.remoteStream);
    const videoCallActive = useGameStore((state) => state.videoCallActive);
    const isOpponentConnected = useGameStore((state) => state.isOpponentConnected);

    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);

    // Effect to attach streams to video elements
    useEffect(() => {
        if (localVideoRef.current && localStream) {
            console.log("Attaching local stream to video element.");
            localVideoRef.current.srcObject = localStream;
        } else if (localVideoRef.current) {
             localVideoRef.current.srcObject = null; // Clear if stream is removed
        }
    }, [localStream]);

    useEffect(() => {
        if (remoteVideoRef.current && remoteStream) {
            console.log("Attaching remote stream to video element.");
            remoteVideoRef.current.srcObject = remoteStream;
        } else if (remoteVideoRef.current) {
             remoteVideoRef.current.srcObject = null; // Clear if stream is removed
        }
    }, [remoteStream]);


    return (
        <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
                {/* Local Video */}
                <div className="relative aspect-video bg-muted rounded overflow-hidden border">
                    <video
                        ref={localVideoRef}
                        autoPlay
                        playsInline // Important for mobile browsers
                        muted // Mute local video to prevent echo
                        className="w-full h-full object-cover"
                    />
                    <p className="absolute bottom-1 left-1 text-xs bg-black bg-opacity-50 text-white px-1 rounded">You</p>
                 </div>

                {/* Remote Video */}
                <div className="relative aspect-video bg-muted rounded overflow-hidden border">
                     <video
                         ref={remoteVideoRef}
                         autoPlay
                         playsInline
                         className="w-full h-full object-cover"
                     />
                      {!remoteStream && (
                         <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                             Opponent's Video
                         </div>
                      )}
                     <p className="absolute bottom-1 left-1 text-xs bg-black bg-opacity-50 text-white px-1 rounded">Opponent</p>
                 </div>
            </div>
            <div className="flex justify-center space-x-2">
                {!videoCallActive ? (
                    <Button
                        onClick={onStartCall}
                        disabled={!isOpponentConnected} // Can only call if opponent is connected
                        size="sm"
                    >
                        Start Call
                    </Button>
                ) : (
                    <Button onClick={onEndCall} variant="destructive" size="sm">
                        End Call
                    </Button>
                )}
                 {!isOpponentConnected && <p className="text-xs text-muted-foreground self-center">Opponent not connected</p>}
            </div>
        </div>
    );
};