declare global {
    namespace Express {

        interface User {
            id: string;
            name: string;
            email?: string | null;
            isGuest: boolean;
        }
      interface Request {
        user?: User; 
        
      }
    }
  }


export {};