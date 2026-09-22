-- Growth Engine background jobs: stage 1, classification, collection exclusion.
ALTER TABLE public.job_runs DROP CONSTRAINT IF EXISTS job_runs_kind_check;
ALTER TABLE public.job_runs ADD CONSTRAINT job_runs_kind_check CHECK (
  kind IN (
    'catalog',
    'gallery',
    'visualizer',
    'mr_extract',
    'fa_extract',
    'mr_stage1',
    'fa_stage1',
    'mr_classify',
    'fa_classify',
    'mr_collections'
  )
);
