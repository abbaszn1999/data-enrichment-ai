export default function TestPerfPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Performance Test</h1>
      <p className="text-muted-foreground mt-2">
        This page has zero data fetching. If navigation to this page is slow,
        the problem is in the layout/framework. If fast, the problem is in
        individual page data loading.
      </p>
    </div>
  );
}
