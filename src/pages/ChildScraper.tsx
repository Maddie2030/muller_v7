import { useState, useEffect, useCallback } from 'react';
import { Search, Loader2, Save, Lock, Unlock, ChevronDown, CheckCircle, XCircle, Image as ImageIcon, RefreshCw, Trash2, Layers } from 'lucide-react';
import { scrape } from '@/lib/scraper';
import {
  listScrapeRecords, getScrapeChildren, saveChildScrapeRecord,
  deleteScrapeRecord, syncScrapeChildToChapter, syncScrapeParentToSeries,
} from '@/lib/dataAccess';
import type { ScrapeResult, ScrapeRecordSummary, ImageItem } from '@/types';

export default function ChildScraper() {
  const [parents, setParents] = useState<ScrapeRecordSummary[]>([]);
  const [lockedParent, setLockedParent] = useState<ScrapeRecordSummary | null>(null);
  const [children, setChildren] = useState<ScrapeRecordSummary[]>([]);
  const [url, setUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ stored: number; total: number } | null>(null);
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const loadParents = useCallback(async () => {
    try {
      const recs = await listScrapeRecords({ limit: 100, parentsOnly: true });
      setParents(recs);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadParents(); }, [loadParents]);

  const loadChildren = useCallback(async (parentId: string) => {
    try {
      const ch = await getScrapeChildren(parentId);
      setChildren(ch);
    } catch { /* ignore */ }
  }, []);

  const handleLockParent = async (parentId: string) => {
    const p = parents.find((r) => r.id === parentId);
    if (!p) return;
    setLockedParent(p);
    setResult(null);
    setError(null);
    setStatusMsg(null);
    await loadChildren(parentId);
  };

  const handleUnlock = () => {
    setLockedParent(null);
    setChildren([]);
    setResult(null);
    setUrl('');
    setError(null);
    setStatusMsg(null);
  };

  const handleScrape = async () => {
    setError(null);
    setResult(null);
    setStatusMsg(null);
    if (!url.trim()) { setError('Enter a URL.'); return; }
    setScraping(true);
    try {
      const res = await scrape(url, 'images');
      setResult(res);
      if (res.status === 'error') setError(res.error ?? 'Scrape failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scrape failed');
    } finally {
      setScraping(false);
    }
  };

  const handleSaveChild = async () => {
    if (!result || !lockedParent) return;
    setSaving(true);
    setSaveProgress({ stored: 0, total: 0 });
    setError(null);
    try {
      const images = extractImages(result);
      const total = images?.length ?? 0;
      const saved = await saveChildScrapeRecord(
        { ...result, parentId: lockedParent.id, editedImages: images },
        (processed, totalCount) => setSaveProgress({ stored: processed, total: totalCount }),
      );
      setStatusMsg(`Saved as child #${saved.position}. ${saved.storedImageCount} of ${total} images stored locally.`);
      setResult(null);
      setUrl('');
      await loadChildren(lockedParent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
      setSaveProgress(null);
    }
  };

  const handleSyncChild = async (id: string) => {
    setSyncing(id);
    setError(null);
    try {
      const ch = await syncScrapeChildToChapter(id);
      if (ch) setStatusMsg(`Synced to chapter ${ch.chapter_number}.`);
      else setError('Sync failed: no matching series found. Sync the parent first.');
      await loadChildren(lockedParent!.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(null);
    }
  };

  const handleSyncParent = async () => {
    if (!lockedParent) return;
    setSyncing(lockedParent.id);
    setError(null);
    try {
      const series = await syncScrapeParentToSeries(lockedParent.id);
      if (series) setStatusMsg(`Parent synced to series: ${series.title}`);
      else setError('Parent sync failed.');
      await loadParents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this child record?')) return;
    await deleteScrapeRecord(id);
    if (lockedParent) await loadChildren(lockedParent.id);
  };

  const previewImages = result ? extractImages(result) ?? [] : [];
  const progressPct = saveProgress && saveProgress.total > 0
    ? Math.round((saveProgress.stored / saveProgress.total) * 100)
    : 0;

  return (
    <div className="mx-auto max-w-5xl animate-fade-in">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold text-ink-100">
        <Layers className="h-6 w-6 text-brand-500" /> Child Scraper
      </h1>

      {error && (
        <div className="mb-4 rounded-lg bg-accent-600/10 px-4 py-3 text-sm text-accent-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-accent-500 hover:text-accent-300">Dismiss</button>
        </div>
      )}
      {statusMsg && (
        <div className="mb-4 rounded-lg bg-success-600/10 px-4 py-3 text-sm text-success-400">
          {statusMsg}
          <button onClick={() => setStatusMsg(null)} className="ml-2 text-success-500 hover:text-success-300">Dismiss</button>
        </div>
      )}

      {!lockedParent ? (
        <div className="card p-6">
          <h2 className="mb-2 text-lg font-semibold text-ink-100">1. Select a Parent Record</h2>
          <p className="mb-4 text-sm text-ink-400">
            Choose a parent scrape record to lock as the context. All children you scrape next will be saved under this parent and their images will be stored with identifiers tied to the parent series and chapter position.
          </p>
          {parents.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-500">
              No parent records found. Go to the Scraper page and save at least one record as a parent first.
            </p>
          ) : (
            <div className="space-y-2">
              {parents.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-900 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink-100">{p.title || p.url}</p>
                    <p className="truncate text-xs text-ink-500">{p.url} - {p.mode} - {new Date(p.created_at).toLocaleDateString()}</p>
                  </div>
                  <button
                    onClick={() => handleLockParent(p.id)}
                    className="btn-primary text-sm whitespace-nowrap"
                  >
                    <Lock className="h-4 w-4" /> Lock & Scrape
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Locked parent banner */}
          <div className="card flex items-center gap-3 p-4">
            <Lock className="h-5 w-5 flex-shrink-0 text-brand-400" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-ink-500">Locked parent</p>
              <p className="truncate font-medium text-ink-100">{lockedParent.title || lockedParent.url}</p>
            </div>
            <button onClick={handleSyncParent} disabled={syncing === lockedParent.id} className="btn-ghost text-xs whitespace-nowrap" title="Sync parent to catalog as series">
              {syncing === lockedParent.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Sync Series
            </button>
            <button onClick={handleUnlock} className="btn-secondary text-sm whitespace-nowrap">
              <Unlock className="h-4 w-4" /> Unlock
            </button>
          </div>

          {/* Scrape form */}
          <div className="card p-6">
            <h2 className="mb-3 text-lg font-semibold text-ink-100">2. Scrape a Child Page</h2>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScrape()}
                placeholder="https://example.com/manga-series/chapter-1"
                className="input-field flex-1"
              />
              <button onClick={handleScrape} disabled={scraping} className="btn-primary whitespace-nowrap">
                {scraping ? <><Loader2 className="h-4 w-4 animate-spin" /> Scraping...</> : <><Search className="h-4 w-4" /> Scrape Images</>}
              </button>
            </div>
          </div>

          {/* Scrape result preview */}
          {result && (
            <div className="card p-6">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="flex items-center gap-2 text-base font-semibold">
                    {result.status === 'success' ? <CheckCircle className="h-5 w-5 text-success-400" /> : <XCircle className="h-5 w-5 text-accent-400" />}
                    {result.title || 'Scrape Result'}
                  </h3>
                  <p className="mt-1 truncate text-xs text-ink-500">{result.url}</p>
                </div>
                {result.status === 'success' && (
                  <button onClick={handleSaveChild} disabled={saving} className="btn-primary text-sm whitespace-nowrap">
                    {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : <><Save className="h-4 w-4" /> Save as Child</>}
                  </button>
                )}
              </div>

              {result.summary && <p className="mb-3 text-sm text-ink-300">{result.summary}</p>}

              {/* Save progress bar */}
              {saving && saveProgress && (
                <div className="mb-4">
                  <div className="mb-1 flex items-center justify-between text-xs text-ink-400">
                    <span>Processing images...</span>
                    <span>{saveProgress.stored} / {saveProgress.total}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-ink-800">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-all duration-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}

              {previewImages.length > 0 && (
                <div>
                  <p className="mb-2 text-sm text-ink-400">{previewImages.length} images found - will be stored on save</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
                    {previewImages.slice(0, 24).map((img, i) => (
                      <div key={i} className="group relative overflow-hidden rounded-lg border border-ink-800">
                        <img src={img.src} alt={img.alt} className="aspect-square w-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.2'; }} />
                        <div className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1 text-xs text-ink-300 opacity-0 transition-opacity group-hover:opacity-100">
                          <p className="truncate">Page {i + 1}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {previewImages.length > 24 && <p className="mt-2 text-xs text-ink-500">...and {previewImages.length - 24} more</p>}
                </div>
              )}
            </div>
          )}

          {/* Saved children list */}
          <div className="card p-6">
            <h2 className="mb-4 text-lg font-semibold text-ink-100">Saved Children ({children.length})</h2>
            {children.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-500">No children saved yet. Scrape a URL above and save it as a child.</p>
            ) : (
              <div className="space-y-2">
                {children.map((ch) => (
                  <div key={ch.id}>
                    <div className="flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-900 p-3">
                      <span className="badge bg-brand-600/20 text-brand-400">#{ch.position}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink-200">{ch.title || ch.url}</p>
                        <p className="truncate text-xs text-ink-500">{ch.url}</p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1">
                        {ch.synced && <span className="badge bg-success-600/20 text-success-400 text-xs">Synced</span>}
                        <button onClick={() => handleSyncChild(ch.id)} disabled={syncing === ch.id} className="btn-ghost text-xs" title="Sync to catalog as chapter">
                          {syncing === ch.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        </button>
                        <button onClick={() => handleDelete(ch.id)} className="btn-ghost text-accent-400" title="Delete"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function extractImages(result: ScrapeResult): ImageItem[] | undefined {
  if (!result.result) return undefined;
  const imagesData = result.result.images as { images?: ImageItem[] } | undefined;
  return imagesData?.images;
}
