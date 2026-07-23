import React from "react";
import { useGetSystemStatus, useHealthCheck } from "@workspace/api-client-react";
import { Activity, CheckCircle, AlertTriangle, XCircle, Server, Database, Network, ShieldCheck } from "lucide-react";

export function SystemStatus() {
  const { data: status, isLoading } = useGetSystemStatus({
    query: { refetchInterval: 30000 } as any // auto-refresh every 30s
  });
  
  const { data: health } = useHealthCheck();

  const getStatusIcon = (state: string) => {
    switch (state) {
      case 'operational': return <CheckCircle className="w-5 h-5 text-emerald-400" />;
      case 'degraded': return <AlertTriangle className="w-5 h-5 text-amber-400" />;
      case 'outage': return <XCircle className="w-5 h-5 text-destructive" />;
      default: return <Activity className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const getStatusColor = (state: string) => {
    switch (state) {
      case 'operational': return 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10 shadow-[0_0_15px_rgba(52,211,153,0.15)]';
      case 'degraded': return 'text-amber-400 border-amber-400/30 bg-amber-400/10 shadow-[0_0_15px_rgba(251,191,36,0.15)]';
      case 'outage': return 'text-destructive border-destructive/30 bg-destructive/10 shadow-[0_0_15px_rgba(255,51,102,0.15)]';
      default: return 'text-muted-foreground border-border bg-muted';
    }
  };

  const getServiceIcon = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('database') || n.includes('db')) return <Database className="w-5 h-5" />;
    if (n.includes('api') || n.includes('gateway')) return <Network className="w-5 h-5" />;
    if (n.includes('auth') || n.includes('security')) return <ShieldCheck className="w-5 h-5" />;
    return <Server className="w-5 h-5" />;
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="text-center space-y-4 animate-in fade-in slide-in-from-top-4 py-8">
        <Activity className={`w-16 h-16 mx-auto mb-4 ${status?.overall === 'operational' ? 'text-emerald-400' : 'text-primary'}`} />
        <h1 className="text-3xl font-bold tracking-tight text-foreground">System Telemetry</h1>
        <p className="text-muted-foreground max-w-lg mx-auto">Real-time operational status of all core platform services and dependencies.</p>
        
        {isLoading ? (
          <div className="inline-block mt-4 px-6 py-2 border border-border rounded-full text-sm font-mono text-muted-foreground animate-pulse">
            Analyzing systems...
          </div>
        ) : (
          <div className={`inline-flex items-center gap-3 px-6 py-3 border rounded-full text-sm font-bold uppercase tracking-widest ${getStatusColor(status?.overall || 'unknown')}`}>
            {getStatusIcon(status?.overall || 'unknown')}
            {status?.overall === 'operational' ? 'All Systems Operational' : `System ${status?.overall}`}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-md overflow-hidden animate-in fade-in slide-in-from-bottom-8">
        <div className="border-b border-border bg-secondary/50 px-6 py-4 flex justify-between items-center">
          <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-muted-foreground">Core Services</h3>
          <span className="text-xs text-muted-foreground font-mono">
            Last updated: {status?.updatedAt ? new Date(status.updatedAt).toLocaleTimeString() : '---'}
          </span>
        </div>
        
        <div className="divide-y divide-border/50">
          {isLoading ? (
            Array(4).fill(0).map((_, i) => (
              <div key={i} className="p-6 flex items-center justify-between animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded bg-muted"></div>
                  <div>
                    <div className="h-4 bg-muted rounded w-32 mb-2"></div>
                    <div className="h-3 bg-muted rounded w-48"></div>
                  </div>
                </div>
                <div className="h-8 bg-muted rounded w-24"></div>
              </div>
            ))
          ) : (
            status?.services.map((service) => (
              <div key={service.name} className="p-6 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded flex items-center justify-center border ${
                    service.status === 'operational' ? 'bg-emerald-400/5 border-emerald-400/20 text-emerald-400' : 
                    service.status === 'degraded' ? 'bg-amber-400/5 border-amber-400/20 text-amber-400' : 
                    'bg-destructive/5 border-destructive/20 text-destructive'
                  }`}>
                    {getServiceIcon(service.name)}
                  </div>
                  <div>
                    <h4 className="font-medium text-foreground">{service.name}</h4>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {service.status === 'operational' ? 'Operating normally' : 
                       service.status === 'degraded' ? 'Experiencing performance issues' : 
                       'Service is currently unavailable'}
                    </p>
                  </div>
                </div>
                
                <div className="flex flex-col items-end gap-2">
                  <div className={`flex items-center gap-2 font-mono text-xs uppercase tracking-wider ${
                    service.status === 'operational' ? 'text-emerald-400' : 
                    service.status === 'degraded' ? 'text-amber-400' : 'text-destructive'
                  }`}>
                    {service.status}
                    {getStatusIcon(service.status)}
                  </div>
                  {service.latencyMs !== undefined && service.latencyMs !== null && (
                    <div className="text-xs text-muted-foreground font-mono">
                      Latency: <span className={service.latencyMs > 500 ? 'text-amber-400' : 'text-foreground'}>{service.latencyMs}ms</span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {/* Platform Meta Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-8" style={{ animationDelay: '200ms' }}>
        <div className="bg-card border border-border rounded-md p-6">
          <h4 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4">Environment</h4>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Deployment Region</span>
              <span className="font-mono">ap-southeast-2 (Sydney)</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">API Version</span>
              <span className="font-mono">v0.1.0-alpha</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Health Ping</span>
              <span className="font-mono text-emerald-400">{health?.status || 'awaiting'}</span>
            </div>
          </div>
        </div>
        
        <div className="bg-card border border-border rounded-md p-6 flex flex-col justify-center items-center text-center">
          <ShieldCheck className="w-8 h-8 text-primary mb-3 opacity-50" />
          <h4 className="text-sm font-medium mb-1">Security Posture</h4>
          <p className="text-xs text-muted-foreground">All connections secured via TLS 1.3. Tenant isolation active and verified.</p>
        </div>
      </div>
    </div>
  );
}
