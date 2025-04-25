import React from 'react';
import { Chessboard } from 'react-chessboard';
import type { Piece, Square } from 'react-chessboard/dist/chessboard/types'; // Corrected import path if needed

interface ChessBoardComponentProps {
  fen: string;
  playerColor?: 'w' | 'b';
  onMove: (move: { from: Square; to: Square; promotion?: Piece }) => void; // Adjusted type based on react-chessboard
  isGameOver: boolean;
}

export const ChessBoardComponent: React.FC<ChessBoardComponentProps> = ({
  fen,
  playerColor = 'w', // Default to white if not specified
  onMove,
  isGameOver,
}) => {

  // Function to handle piece drop
  function handlePieceDrop(sourceSquare: Square, targetSquare: Square, piece: Piece): boolean {
    console.log(`Piece dropped: ${piece} from ${sourceSquare} to ${targetSquare}`);
    if (isGameOver) {
        console.log("Move prevented: Game is over.");
        return false; // Don't allow moves if game is over
    }

    // Basic check: Can't move opponent's pieces (optional, server validates anyway)
    const pieceColor = piece.charAt(0); // 'w' or 'b'
     if (pieceColor !== playerColor) {
         console.log("Move prevented: Tried to move opponent's piece.");
         return false;
     }

    // Check for promotion
    const isPromotion =
      (piece === 'wP' && sourceSquare[1] === '7' && targetSquare[1] === '8') ||
      (piece === 'bP' && sourceSquare[1] === '2' && targetSquare[1] === '1');

    let promotionPiece: Piece | undefined = undefined;
    if (isPromotion) {
      // Always promote to Queen for simplicity in this example
      // Production apps should prompt the user
      promotionPiece = (playerColor === 'w' ? 'wQ' : 'bQ') as Piece;
      console.log(`Promoting pawn to ${promotionPiece}`);
    }

    // Inform the GamePage about the move attempt
    onMove({
      from: sourceSquare,
      to: targetSquare,
      promotion: promotionPiece,
    });

    // Return true signifies the move is potentially valid from the UI perspective.
    // The actual validation happens on the server based on the FEN state.
    // react-chessboard uses this return value for visual feedback (e.g., snapping back).
    // Since server validates, we can be optimistic here.
    return true;
  }


  return (
    <Chessboard
      position={fen}
      onPieceDrop={handlePieceDrop}
      boardOrientation={playerColor === 'w' ? 'white' : 'black'}
      arePiecesDraggable={!isGameOver} // Disable dragging if game over
      // Add custom styles or other props as needed
      // customBoardStyle={{ borderRadius: '4px', boxShadow: '0 2px 10px rgba(0, 0, 0, 0.5)' }}
      // customDarkSquareStyle={{ backgroundColor: '#779952' }}
      // customLightSquareStyle={{ backgroundColor: '#edeed1' }}
    />
  );
};