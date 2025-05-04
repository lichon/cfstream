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
          style={{
            position: 'fixed',
            bottom: '0',
            minHeight: '10%',
            width: '100%',
            maxHeight: '60%',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '10px',
            overflow: 'auto',
            zIndex: 9998,
            borderRadius: '4px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {logs.map((log, index) => (
            <div
              key={index}
              style={{
                color:
                  log.type === 'error'
                    ? '#ff6b6b'
                    : log.type === 'warn'
                    ? '#ffd93d'
                    : '#6bff6b',
                marginBottom: '5px',
                fontSize: '12px',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                textAlign: 'left',
                width: '100%',
              }}
            >
              <span style={{ opacity: 0.7 }}>
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