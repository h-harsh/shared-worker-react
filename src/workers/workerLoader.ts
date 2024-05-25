export default function SharedWorkerLoader(workerUrl: string): SharedWorker {
    return new SharedWorker(workerUrl, { type: 'module' });
}