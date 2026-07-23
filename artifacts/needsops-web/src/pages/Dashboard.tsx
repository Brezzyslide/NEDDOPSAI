import React from "react";
import { 
  useGetDashboardSummary, 
  useGetSystemStatus 
} from "@workspace/api-client-react";
import { Activity, Box, Building2, Server, Users } from "lucide-react";
import { Link } from "wouter";

function MetricCard({ title, value, label, icon: Icon, delay }: { title: string, value: React.ReactNode, label: string, icon: any, delay: number }) {
  return (
    <div 
      className="bg-card border border-border rounded-md p-5 relative overflow-hidden group hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,240,255,0.1)] animate-in fade-in slide-in-from-bottom-4"
      style={{ animationDelay: `${delay}ms`, animationFillMode: "both" }}
    >
      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
        <Icon className="w-16 h-16 text-primary" />
      </div>
      <div className="relative z-10">
        <h3 className="text-muted-foreground font-mono text-xs uppercase tracking-widest mb-2">{title}</h3>
        <div className="text-4xl font-bold font-mono text-foreground tracking-tight mb-2">{value}</div>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
      <div className="absolute bottom-0 left-0 h-0.5 bg-primary w-0 group-hover:w-full transition-all duration-500 ease-out"></div>
    </div>
  );
}

export function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: systemStatus, isLoading: loadingStatus } = useGetSystemStatus();

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-border pb-6 animate-in fade-in slide-in-from-top-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2 flex items-center gap-3">
            Command Centre
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-primary/20 text-primary border border-primary/30 uppercase tracking-widest box-glow">Active</span>
          </h1>
          <p className="text-muted-foreground">Monitor platform operations and coordinate AI workforce packs.</p>
        </div>
        <div className="text-right flex flex-col items-end gap-1">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Platform Build</div>
          <div className="font-mono text-primary bg-primary/10 px-2 py-1 border border-primary/20 rounded-sm">
            {loadingSummary ? "LOADING..." : `v${summary?.platformVersion || "0.0.0"}`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard 
          title="Total Organizations" 
          value={loadingSummary ? "--" : summary?.totalOrganizations || 0} 
          label={`${summary?.activeOrganizations || 0} active tenants`}
          icon={Building2}
          delay={100}
        />
        <MetricCard 
          title="Total Users" 
          value={loadingSummary ? "--" : summary?.totalUsers || 0} 
          label="Registered personnel"
          icon={Users}
          delay={200}
        />
        <MetricCard 
          title="Workforce Packs" 
          value={loadingSummary ? "--" : summary?.workforcePacksAvailable || 0} 
          label="Available deployments"
          icon={Box}
          delay={300}
        />
        <MetricCard 
          title="System Status" 
          value={
            loadingStatus ? "--" : (
              <span className={systemStatus?.overall === "operational" ? "text-emerald-400" : "text-amber-400"}>
                {systemStatus?.overall === "operational" ? "OK" : systemStatus?.overall?.toUpperCase() || "UNKNOWN"}
              </span>
            )
          } 
          label="Overall platform health"
          icon={Activity}
          delay={400}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        {/* Quick Actions Panel */}
        <div className="bg-card border border-border rounded-md overflow-hidden animate-in fade-in slide-in-from-bottom-8" style={{ animationDelay: "500ms", animationFillMode: "both" }}>
          <div className="border-b border-border bg-secondary/50 px-5 py-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Server className="w-4 h-4 text-primary" />
              Operational Directives
            </h3>
          </div>
          <div className="p-5 space-y-4">
            <p className="text-sm text-muted-foreground mb-6">Execute rapid operations from the command surface. All actions are logged and audited.</p>
            
            <div className="grid grid-cols-2 gap-4">
              <Link href="/organizations" className="flex flex-col p-4 bg-background border border-border rounded hover:border-primary/50 transition-colors group cursor-pointer">
                <Building2 className="w-6 h-6 text-muted-foreground group-hover:text-primary mb-3 transition-colors" />
                <span className="font-semibold text-sm">Manage Organizations</span>
                <span className="text-xs text-muted-foreground mt-1">Deploy and configure tenants</span>
              </Link>
              <Link href="/workforce" className="flex flex-col p-4 bg-background border border-border rounded hover:border-primary/50 transition-colors group cursor-pointer">
                <Users className="w-6 h-6 text-muted-foreground group-hover:text-primary mb-3 transition-colors" />
                <span className="font-semibold text-sm">Browse Workforce</span>
                <span className="text-xs text-muted-foreground mt-1">Review AI worker capabilities</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Status Panel */}
        <div className="bg-card border border-border rounded-md overflow-hidden animate-in fade-in slide-in-from-bottom-8" style={{ animationDelay: "600ms", animationFillMode: "both" }}>
          <div className="border-b border-border bg-secondary/50 px-5 py-4 flex justify-between items-center">
            <h3 className="font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Subsystem Health
            </h3>
            <Link href="/system" className="text-xs text-primary hover:underline font-mono uppercase tracking-wider">
              View All
            </Link>
          </div>
          <div className="p-0">
            {loadingStatus ? (
              <div className="p-8 text-center text-muted-foreground font-mono text-sm animate-pulse">Retrieving telemetry...</div>
            ) : systemStatus?.services.slice(0, 4).map((service, i) => (
              <div key={service.name} className={`flex items-center justify-between p-4 border-b border-border/50 last:border-0 ${i % 2 === 0 ? 'bg-background/30' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${service.status === 'operational' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : service.status === 'degraded' ? 'bg-amber-400' : 'bg-destructive'}`}></div>
                  <span className="text-sm font-medium">{service.name}</span>
                </div>
                <div className="flex items-center gap-4">
                  {service.latencyMs !== undefined && service.latencyMs !== null && (
                    <span className="text-xs font-mono text-muted-foreground">{service.latencyMs}ms</span>
                  )}
                  <span className={`text-xs font-mono uppercase px-2 py-0.5 rounded-sm border ${
                    service.status === 'operational' ? 'border-emerald-400/30 text-emerald-400 bg-emerald-400/10' : 
                    service.status === 'degraded' ? 'border-amber-400/30 text-amber-400 bg-amber-400/10' : 
                    'border-destructive/30 text-destructive bg-destructive/10'
                  }`}>
                    {service.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
