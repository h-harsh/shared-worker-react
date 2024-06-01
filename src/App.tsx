import  { useEffect, useState, useRef } from 'react';

function App() {
  const [message, setMessage] = useState<string>('');
  const [response, setResponse] = useState<string>('');
  const workerRef = useRef<SharedWorker | null>(null);

  useEffect(() => {
    // Check if the browser supports Shared Workers
    if (typeof SharedWorker !== 'undefined') {
      workerRef.current = new SharedWorker(new URL('./sharedWorker.js', import.meta.url), { type: 'module' });

      workerRef.current.port.addEventListener('message', (event: MessageEvent) => {
        setResponse(event.data);
      });

      workerRef.current.port.start();

      // Send a message to the Shared Worker
      workerRef.current.port.postMessage('Hello, Shared Worker!');
    } else {
      console.warn('Shared Workers are not supported in this browser.');
    }

    // Clean up the worker on component unmount
    return () => {
      workerRef.current?.port.close();
    };
  }, []);

  const sendMessage = () => {
    if (workerRef.current) {
      workerRef.current.port.postMessage(message);
    }
  };

  return (
    <div>
      <h1>Shared Worker Example</h1>
      <input 
        type="text" 
        value={message} 
        onChange={(e) => setMessage(e.target.value)} 
        placeholder="Type a message" 
      />
      <button onClick={sendMessage}>Send Message</button>
      <p>Response from Worker: {response}</p>
    </div>
  );
}

export default App;
