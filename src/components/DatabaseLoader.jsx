import { useState, useEffect, createContext, useContext } from 'react';

/**
 * Context for database access throughout the app.
 */
export const DatabaseContext = createContext(null);

/**
 * Hook to access the database context.
 */
export function useDatabase() {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error('useDatabase must be used within DatabaseProvider');
  }
  return context;
}

/**
 * Database URL — always relative to the app base so it works in dev,
 * in the built app, and on GitHub Pages without any hardcoded origins.
 */
const DATABASE_URL = import.meta.env.BASE_URL + 'database/database.json';

/**
 * DatabaseLoader component.
 * Fetches the buffer database and provides it via context.
 */
export function DatabaseLoader({ children, databaseUrl = DATABASE_URL }) {
  const [database, setDatabase] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDatabase() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(databaseUrl);
        if (!response.ok) {
          throw new Error(`Failed to load database: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();

        // Add a synthetic buffer_id for databases that don't include one
        for (const buf of data.buffers) {
          if (!buf.buffer_id) {
            buf.buffer_id = `${buf.sample_id}/${buf.buffer_name}`;
          }
        }

        if (!cancelled) {
          // Build maps for quick lookup
          const samplesMap = new Map(data.samples.map(s => [s.sample_id, s]));
          const buffersMap = new Map(data.buffers.map(b => [b.buffer_id, b]));

          setDatabase({
            ...data,
            samplesMap,
            buffersMap
          });
          setLoading(false);

          // Cache in localStorage for offline use
          try {
            localStorage.setItem('nmr-ph-database', JSON.stringify(data));
            localStorage.setItem('nmr-ph-database-timestamp', Date.now().toString());
          } catch (e) {
            console.warn('Failed to cache database:', e);
          }
        }
      } catch (err) {
        console.error('Database load error:', err);

        // Try to load from cache
        try {
          const cached = localStorage.getItem('nmr-ph-database');
          if (cached) {
            const data = JSON.parse(cached);
            const samplesMap = new Map(data.samples.map(s => [s.sample_id, s]));
            const buffersMap = new Map(data.buffers.map(b => [b.buffer_id, b]));

            if (!cancelled) {
              setDatabase({
                ...data,
                samplesMap,
                buffersMap
              });
              setLoading(false);
              setError('Using cached database (could not fetch latest)');
            }
            return;
          }
        } catch (cacheErr) {
          console.warn('Cache load failed:', cacheErr);
        }

        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    }

    loadDatabase();

    return () => {
      cancelled = true;
    };
  }, [databaseUrl]);

  // Get available solvents from database
  const solvents = database
    ? [...new Set(database.samples.map(s => s.solvent))].filter(Boolean)
    : [];

  // Get buffers filtered by solvent
  const getBuffersForSolvent = (solvent) => {
    if (!database) return [];
    const sampleIds = database.samples
      .filter(s => s.solvent === solvent)
      .map(s => s.sample_id);
    return database.buffers.filter(b => sampleIds.includes(b.sample_id));
  };

  // Get available nuclei for selected buffers
  const getNucleiForBuffers = (buffers) => {
    const nuclei = new Set();
    for (const buffer of buffers) {
      for (const nucleus of Object.keys(buffer.chemical_shifts)) {
        nuclei.add(nucleus);
      }
    }
    return [...nuclei].sort();
  };

  const contextValue = {
    database,
    loading,
    error,
    solvents,
    getBuffersForSolvent,
    getNucleiForBuffers,
    getSample: (sampleId) => database?.samplesMap.get(sampleId),
    getBuffer: (bufferId) => database?.buffersMap.get(bufferId)
  };

  if (loading) {
    return (
      <div className="database-loader loading">
        <div className="spinner"></div>
        <p>Loading buffer database...</p>
      </div>
    );
  }

  if (error && !database) {
    return (
      <div className="database-loader error">
        <h2>Database Load Error</h2>
        <p>{error}</p>
        <p>
          Please check your internet connection or{' '}
          <a href="https://github.com/waudbylab/nmr-pH/issues" target="_blank" rel="noopener noreferrer">
            report an issue
          </a>.
        </p>
      </div>
    );
  }

  return (
    <DatabaseContext.Provider value={contextValue}>
      {error && (
        <div className="database-warning">
          <span className="warning-icon">&#9888;</span> {error}
        </div>
      )}
      {children}
    </DatabaseContext.Provider>
  );
}

export default DatabaseLoader;
