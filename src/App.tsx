// src/App.tsx
// @ts-nocheck
import React, { useEffect, useRef } from 'react';
import SharedWorkerLoader from './workers/workerLoader';

const App: React.FC = () => {
    const workerRef = useRef<SharedWorker | null>(null);

    useEffect(() => {
        // workerRef.current = SharedWorkerLoader(new URL('./workers/sharedWorker.ts', import.meta.url).toString());
        workerRef.current = SharedWorkerLoader(new URL('/public/sharedWorker.js', import.meta.url));
        workerRef.current.port.start();

        workerRef.current.port.onmessage = (event: MessageEvent) => {
            console.log('Message from worker:', event.data);
        };

        return () => {
            workerRef.current?.port.close();
        };
    }, []);

    const sendMessage = () => {
        if (workerRef.current) {
            workerRef.current.port.postMessage('Hello from App');
        }
    };

    return (
        <div>
            <h1>Shared Worker Example</h1>
            <button onClick={sendMessage}>Send Message to Worker</button>
        </div>
    );
};

export default App;
