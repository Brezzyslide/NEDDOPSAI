import { FileQuestion, MoveLeft } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4 animate-in fade-in zoom-in duration-500">
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full" />
        <div className="w-24 h-24 rounded-2xl bg-card border border-border flex items-center justify-center shadow-[0_0_30px_rgba(0,240,255,0.15)] relative z-10">
          <FileQuestion className="w-12 h-12 text-primary" />
        </div>
      </div>
      
      <h1 className="text-4xl font-bold font-mono tracking-tight mb-3">
        ERROR <span className="text-primary text-glow">404</span>
      </h1>
      
      <p className="text-muted-foreground max-w-md mb-8">
        The requested operational module or resource coordinate could not be resolved in the command hierarchy.
      </p>
      
      <Link href="/" className="flex items-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 px-6 py-3 rounded-sm font-medium transition-all hover:shadow-[0_0_15px_rgba(0,240,255,0.2)]">
          <MoveLeft className="w-4 h-4" />
          Return to Command Centre
      </Link>
    </div>
  );
}
