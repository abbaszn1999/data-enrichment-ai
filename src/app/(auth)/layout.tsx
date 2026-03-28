import { FileSpreadsheet } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="flex items-center gap-2 mb-8">
        <div className="p-1.5 rounded-lg bg-primary">
          <FileSpreadsheet className="h-5 w-5 text-primary-foreground" />
        </div>
        <span className="font-bold text-lg tracking-tight">DataSheet AI</span>
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
