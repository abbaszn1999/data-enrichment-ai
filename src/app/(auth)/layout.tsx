import Image from "next/image";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="flex items-center gap-2 mb-8">
        <div className="relative w-8 h-8 rounded-lg overflow-hidden bg-white flex items-center justify-center border border-border/40">
          <Image
            src="/autommerce.png"
            alt="Autommerce Logo"
            fill
            sizes="32px"
            className="object-contain p-0.5"
            priority
          />
        </div>
        <span className="font-bold text-lg tracking-tight">Autommerce Data Entry</span>
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
