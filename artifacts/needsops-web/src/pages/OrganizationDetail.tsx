import React from "react";
import { useRoute, Link } from "wouter";
import { useGetOrganization, useListOrganizationUsers } from "@workspace/api-client-react";
import { ArrowLeft, Building2, Users, HardDrive, Settings, Activity, Clock, ShieldAlert } from "lucide-react";

export function OrganizationDetail() {
  const [, params] = useRoute("/organizations/:id");
  const id = params?.id || "";

  const { data: org, isLoading: loadingOrg } = useGetOrganization(id, {
    query: { enabled: !!id } as any
  });

  const { data: usersData, isLoading: loadingUsers } = useListOrganizationUsers(id, {
    query: { enabled: !!id } as any
  });

  if (loadingOrg) {
    return (
      <div className="flex items-center justify-center h-64 text-primary font-mono text-sm uppercase tracking-widest animate-pulse">
        <Activity className="w-5 h-5 mr-3 animate-spin" />
        Establishing Telemetry...
      </div>
    );
  }

  if (!org) {
    return (
      <div className="text-center py-20">
        <ShieldAlert className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">Tenant Not Found</h2>
        <p className="text-muted-foreground mb-6">The requested organization record could not be located in the registry.</p>
        <Link href="/organizations" className="text-primary hover:underline inline-flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> Return to Directory
        </Link>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30';
      case 'trial': return 'text-primary bg-primary/10 border-primary/30';
      case 'suspended': return 'text-amber-400 bg-amber-400/10 border-amber-400/30';
      case 'inactive': return 'text-muted-foreground bg-muted border-border';
      default: return 'text-muted-foreground bg-muted border-border';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-in fade-in slide-in-from-top-4">
        <Link href="/organizations" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors font-mono uppercase tracking-widest mb-6">
          <ArrowLeft className="w-3 h-3" /> Back to Organizations
        </Link>
        
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded bg-secondary flex items-center justify-center border border-border shadow-[0_0_20px_rgba(0,0,0,0.5)]">
              <Building2 className="w-8 h-8 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">{org.name}</h1>
                <span className={`px-2 py-0.5 text-[10px] uppercase tracking-wider font-mono border rounded-sm ${getStatusColor(org.status)}`}>
                  {org.status}
                </span>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground font-mono">
                <span className="flex items-center gap-1"><HardDrive className="w-3.5 h-3.5" /> ID: {org.id.substring(0,8)}...</span>
                <span>•</span>
                <span>Slug: {org.slug}</span>
                <span>•</span>
                <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Deployed: {new Date(org.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 px-3 py-2 border border-border rounded-sm text-sm font-medium hover:bg-accent hover:text-foreground transition-colors bg-card">
              <Settings className="w-4 h-4" />
              Configure Tenant
            </button>
            <button className="flex items-center gap-2 px-3 py-2 border border-border rounded-sm text-sm font-medium text-destructive hover:bg-destructive/10 hover:border-destructive/30 transition-colors bg-card">
              Suspend
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Details */}
        <div className="space-y-6 lg:col-span-1">
          <div className="bg-card border border-border rounded-md overflow-hidden animate-in fade-in" style={{ animationDelay: '100ms' }}>
            <div className="border-b border-border bg-secondary/50 px-5 py-3">
              <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-muted-foreground">Tenant Profile</h3>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <div className="text-xs text-muted-foreground font-mono uppercase tracking-widest mb-1">Industry</div>
                <div className="font-medium">{org.industry || 'Unspecified'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground font-mono uppercase tracking-widest mb-1">Subscription Tier</div>
                <div className="font-medium capitalize">{org.subscriptionTier}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground font-mono uppercase tracking-widest mb-1">Last Modified</div>
                <div className="font-medium font-mono text-sm">{new Date(org.updatedAt).toLocaleString()}</div>
              </div>
              <div className="pt-4 border-t border-border mt-4">
                <div className="text-xs text-muted-foreground font-mono uppercase tracking-widest mb-2">Resource Utilization</div>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Compute Credits</span>
                      <span className="font-mono">45%</span>
                    </div>
                    <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary w-[45%] shadow-[0_0_10px_rgba(0,240,255,0.8)]"></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Storage Allocation</span>
                      <span className="font-mono">12%</span>
                    </div>
                    <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-400 w-[12%]"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Users & Packs */}
        <div className="space-y-6 lg:col-span-2">
          {/* Users Table */}
          <div className="bg-card border border-border rounded-md overflow-hidden animate-in fade-in" style={{ animationDelay: '200ms' }}>
            <div className="border-b border-border bg-secondary/50 px-5 py-3 flex justify-between items-center">
              <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-muted-foreground flex items-center gap-2">
                <Users className="w-4 h-4" /> Personnel Roster
              </h3>
              <span className="text-xs font-mono bg-background border border-border px-2 py-0.5 rounded">{org.userCount} Total</span>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-background/50 border-b border-border font-mono tracking-wider">
                  <tr>
                    <th className="px-5 py-3 font-medium">User</th>
                    <th className="px-5 py-3 font-medium">Role</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loadingUsers ? (
                     <tr><td colSpan={4} className="px-5 py-8 text-center text-muted-foreground text-sm font-mono animate-pulse">Loading personnel data...</td></tr>
                  ) : usersData?.items?.length === 0 ? (
                    <tr><td colSpan={4} className="px-5 py-8 text-center text-muted-foreground text-sm">No users registered for this tenant.</td></tr>
                  ) : (
                    usersData?.items?.map((user) => (
                      <tr key={user.id} className="hover:bg-accent/20 transition-colors">
                        <td className="px-5 py-3">
                          <div className="font-medium text-foreground">{user.firstName} {user.lastName}</div>
                          <div className="text-xs text-muted-foreground">{user.email}</div>
                        </td>
                        <td className="px-5 py-3">
                          <span className="capitalize">{user.role}</span>
                        </td>
                        <td className="px-5 py-3">
                           <span className={`px-2 py-0.5 text-[10px] uppercase tracking-wider font-mono border rounded-sm ${
                             user.status === 'active' ? 'text-emerald-400 border-emerald-400/30' : 
                             user.status === 'invited' ? 'text-primary border-primary/30' : 
                             'text-amber-400 border-amber-400/30'
                           }`}>
                            {user.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground font-mono text-xs">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          
          {/* Workforce Packs Assignment */}
          <div className="bg-card border border-border rounded-md overflow-hidden animate-in fade-in" style={{ animationDelay: '300ms' }}>
            <div className="border-b border-border bg-secondary/50 px-5 py-3 flex justify-between items-center">
              <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-muted-foreground flex items-center gap-2">
                <Activity className="w-4 h-4" /> Active Deployments
              </h3>
              <button className="text-xs text-primary hover:underline font-mono">Assign Pack</button>
            </div>
            <div className="p-5">
              <div className="border border-dashed border-border rounded-md p-8 text-center bg-background/50">
                <Activity className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-50" />
                <h4 className="text-sm font-medium mb-1">No AI Workforce Deployed</h4>
                <p className="text-xs text-muted-foreground mb-4 max-w-md mx-auto">This organization currently has no AI workforce packs assigned to their environment. Deploy a pack to activate their AI operations.</p>
                <Link href="/workforce" className="inline-flex items-center gap-2 bg-secondary text-foreground border border-border hover:border-primary/50 px-4 py-2 rounded-sm text-sm font-medium transition-colors">
                  Browse Available Packs
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
