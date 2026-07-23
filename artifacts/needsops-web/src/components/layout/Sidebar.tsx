import React from "react";
import { Link, useLocation } from "wouter";
import { Activity, LayoutDashboard, Users, Cpu, Settings, Globe } from "lucide-react";

export function Sidebar() {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Command Centre", icon: LayoutDashboard },
    { href: "/organizations", label: "Organizations", icon: Globe },
    { href: "/workforce", label: "Workforce Packs", icon: Users },
    { href: "/system", label: "System Status", icon: Activity },
  ];

  return (
    <aside className="w-64 border-r border-border bg-sidebar flex flex-col h-full">
      <div className="p-6 border-b border-border flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground shadow-[0_0_15px_rgba(0,240,255,0.4)]">
          <Cpu className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-wider text-foreground text-glow uppercase">NeedsOps</h1>
          <p className="text-[10px] uppercase tracking-widest text-primary font-mono">AI+ Command</p>
        </div>
      </div>
      
      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-4 px-2">Core Modules</div>
        {navItems.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href}>
              <div 
                className={`flex items-center gap-3 px-3 py-2.5 rounded-sm transition-all duration-200 cursor-pointer ${
                  isActive 
                    ? "bg-primary/10 text-primary border border-primary/20 box-glow" 
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground border border-transparent"
                }`}
                data-testid={`nav-link-${item.label.toLowerCase().replace(' ', '-')}`}
              >
                <item.icon className="w-4 h-4" />
                <span className="font-medium text-sm">{item.label}</span>
                {isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(0,240,255,1)]" />
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-sm text-muted-foreground hover:bg-white/5 hover:text-foreground cursor-pointer transition-colors">
          <Settings className="w-4 h-4" />
          <span className="font-medium text-sm">Platform Settings</span>
        </div>
        <div className="mt-4 px-3 flex items-center justify-between text-xs text-muted-foreground font-mono">
          <span>Sys: OK</span>
          <span className="text-emerald-400">●</span>
        </div>
      </div>
    </aside>
  );
}
