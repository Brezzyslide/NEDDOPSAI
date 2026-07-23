import React from "react";
import { Bell, Search, User } from "lucide-react";
import { useLocation } from "wouter";

export function TopBar() {
  const [location] = useLocation();

  const getPageTitle = () => {
    if (location === "/") return "Command Centre Overview";
    if (location.startsWith("/organizations")) return "Organizations Management";
    if (location.startsWith("/workforce")) return "Workforce Packs Browser";
    if (location.startsWith("/system")) return "System Health & Status";
    return "Operations";
  };

  return (
    <header className="h-16 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center justify-between px-6 z-10 sticky top-0">
      <div className="flex items-center gap-4">
        <h2 className="text-sm font-mono text-muted-foreground uppercase tracking-widest border-r border-border pr-4">
          Terminal <span className="text-primary">{location}</span>
        </h2>
        <div className="text-lg font-semibold">{getPageTitle()}</div>
      </div>

      <div className="flex items-center gap-6">
        <div className="relative group hidden md:block">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
          <input 
            type="text" 
            placeholder="Query operational data..." 
            className="bg-accent/50 border border-border rounded-sm pl-9 pr-4 py-1.5 text-sm focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all w-64 font-mono placeholder:text-muted-foreground/50"
          />
        </div>
        
        <div className="flex items-center gap-4 border-l border-border pl-6">
          <button className="relative text-muted-foreground hover:text-foreground transition-colors">
            <Bell className="w-5 h-5" />
            <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-primary shadow-[0_0_5px_rgba(0,240,255,0.8)] border border-background"></span>
          </button>
          
          <div className="flex items-center gap-2 cursor-pointer group">
            <div className="w-8 h-8 rounded bg-secondary border border-border flex items-center justify-center text-muted-foreground group-hover:border-primary/50 transition-colors">
              <User className="w-4 h-4" />
            </div>
            <div className="hidden lg:block text-sm">
              <div className="font-medium">Ops Admin</div>
              <div className="text-xs text-muted-foreground font-mono">ID: OP-094</div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
