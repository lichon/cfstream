import React, { useState, useEffect } from 'react';

interface LogEntry {
  message: string;
  type: 'log' | 'error' | 'warn';
  timestamp: string;
}

interface LoggingOverlayProps {
  show: boolean;
}

const LoggingOverlay: React.FC<LoggingOverlayProps> = ({ show: isVisible }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
    };

    console.log = (...args) => {
      const entry = {
        message: args.map(arg => JSON.stringify(arg)).join(' '),
        type: 'log' as const,
        timestamp: new Date().toISOString(),
      };
      setLogs(prev => [...prev, entry]);
      originalConsole.log(...args);
    };

    console.error = (...args) => {
      const entry = {
        message: args.map(arg => JSON.stringify(arg)).join(' '),
        type: 'error' as const,
        timestamp: new Date().toISOString(),
      };
      setLogs(prev => [...prev, entry]);
      originalConsole.error(...args);
    };

    console.warn = (...args) => {
      const entry = {
        message: args.map(arg => JSON.stringify(arg)).join(' '),
        type: 'warn' as const,
        timestamp: new Date().toISOString(),
      };
      setLogs(prev => [...prev, entry]);
      originalConsole.warn(...args);
    };

    return () => {
      console.log = originalConsole.log;
      console.error = originalConsole.error;
      console.warn = originalConsole.warn;
    };
  }, []);

  return (
    <>
      {isVisible && (
        <div
          className="fixed bottom-0 w-full min-h-[10%] max-h-[60%] bg-black/80 text-white p-2 overflow-auto z-[9998] rounded flex flex-col"
        >
          {logs.map((log, index) => (
            <div
              key={index}
              className={`
                mb-1 text-xs font-mono whitespace-pre-wrap break-words text-left w-full
                ${log.type === 'error' ? 'text-red-400' : log.type === 'warn' ? 'text-yellow-300' : 'text-green-400'}
              `}
            >
              <span className="opacity-70">
                {new Date(log.timestamp).toLocaleTimeString()} -{' '}
              </span>
              {log.message}
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default LoggingOverlay;