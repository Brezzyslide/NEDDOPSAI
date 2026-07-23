import React, { useState } from "react";
import { useListOrganizations } from "@workspace/api-client-react";
import { Search, Filter, Plus, Building2, MoreHorizontal, Eye, Server, RefreshCw } from "lucide-react";
import { Link } from "wouter";

export function OrganizationsList() {
  const [search, setSearch] = useState("");
  
  // Using generic options object type that matches the generated hook
  const { data, isLoading, refetch, isFetching } = useListOrganizations(
    { page: 1, limit: 50, search: search || undefined }, 
    { query: { keepPreviousData: true } as any }
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30';
      case 'trial': return 'text-primary bg-primary/10 border-primary/30';
      case 'suspended': return 'text-amber-400 bg-amber-400/10 border-amber-400/30';
      case 'inactive': return 'text-muted-foreground bg-muted border-border';
      default: return 'text-muted-foreground bg-muted border-border';
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'enterprise': return 'text-[#b975f8] border-[#b975f8]/30 bg-[#b975f8]/10';
      case 'professional': return 'text-[#3b82f6] border-[#3b82f6]/30 bg-[#3b82f6]/10';
      case 'starter': return 'text-[#94a3b8] border-[#94a3b8]/30 bg-[#94a3b8]/10';
      default: return 'text-muted-foreground border-border bg-transparent';
    }
  };

  return (
    <div className="space-y-6 max-w-full">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 animate-in fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary" />
            Organizations
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Manage tenant environments and deployments.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => refetch()}
            className="p-2 border border-border rounded-sm hover:border-primary/50 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
            disabled={isFetching}
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
          <button className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-sm font-medium hover:bg-primary/90 transition-colors shadow-[0_0_15px_rgba(0,240,255,0.3)] hover:shadow-[0_0_20px_rgba(0,240,255,0.5)]">
            <Plus className="w-4 h-4" />
            Deploy Tenant
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-md overflow-hidden animate-in fade-in slide-in-from-bottom-4" style={{ animationDelay: "100ms" }}>
        {/* Toolbar */}
        <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-4 justify-between bg-secondary/20">
          <div className="relative w-full sm:w-96 group">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary" />
            <input 
              type="text" 
              placeholder="Search organizations..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-background border border-border rounded-sm pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all font-mono"
            />
          </div>
          <div className="flex gap-2">
            <button className="flex items-center gap-2 px-3 py-2 border border-border rounded-sm text-sm font-medium hover:bg-accent hover:text-foreground transition-colors bg-background">
              <Filter className="w-4 h-4" />
              Filter
            </button>
          </div>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-secondary/50 border-b border-border font-mono tracking-wider">
              <tr>
                <th className="px-6 py-4 font-medium">Organization</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium">Tier</th>
                <th className="px-6 py-4 font-medium text-right">Users</th>
                <th className="px-6 py-4 font-medium">Deployed</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i} className="animate-pulse bg-background/50">
                    <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-3/4 mb-2"></div><div className="h-3 bg-muted rounded w-1/2"></div></td>
                    <td className="px-6 py-4"><div className="h-5 bg-muted rounded w-20"></div></td>
                    <td className="px-6 py-4"><div className="h-5 bg-muted rounded w-24"></div></td>
                    <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-8 ml-auto"></div></td>
                    <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-24"></div></td>
                    <td className="px-6 py-4"><div className="h-8 bg-muted rounded w-8 ml-auto"></div></td>
                  </tr>
                ))
              ) : data?.items?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center">
                      <Server className="w-12 h-12 mb-4 opacity-20" />
                      <p className="font-mono uppercase tracking-widest text-xs">No organizations found</p>
                      <p className="text-sm mt-2">Adjust search parameters or deploy a new tenant.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                data?.items?.map((org, index) => (
                  <tr 
                    key={org.id} 
                    className="hover:bg-accent/30 transition-colors group cursor-pointer"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center border border-border group-hover:border-primary/40 transition-colors">
                          <span className="font-bold text-xs">{org.name.substring(0, 2).toUpperCase()}</span>
                        </div>
                        <div>
                          <Link href={`/organizations/${org.id}`} className="font-medium text-foreground hover:text-primary transition-colors block">
                            {org.name}
                          </Link>
                          <div className="text-xs text-muted-foreground font-mono mt-0.5">{org.slug}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-[10px] uppercase tracking-wider font-mono border rounded-sm ${getStatusColor(org.status)}`}>
                        {org.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-[10px] uppercase tracking-wider font-mono border rounded-sm ${getTierColor(org.subscriptionTier)}`}>
                        {org.subscriptionTier}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-muted-foreground">
                      {org.userCount}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground font-mono text-xs">
                      {new Date(org.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/organizations/${org.id}`} className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-colors block" title="View details">
                            <Eye className="w-4 h-4" />
                        </Link>
                        <button className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors" title="Options">
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination footer (mocked for visual completeness) */}
        {!isLoading && data && data.total > 0 && (
          <div className="p-4 border-t border-border bg-secondary/10 flex items-center justify-between text-xs text-muted-foreground font-mono">
            <div>
              Showing {((data.page - 1) * data.limit) + 1} to {Math.min(data.page * data.limit, data.total)} of {data.total} entries
            </div>
            <div className="flex items-center gap-1">
              <button className="px-3 py-1 border border-border rounded bg-background hover:bg-accent disabled:opacity-50" disabled={data.page === 1}>Prev</button>
              <button className="px-3 py-1 border border-border rounded bg-background hover:bg-accent disabled:opacity-50" disabled={data.page * data.limit >= data.total}>Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
