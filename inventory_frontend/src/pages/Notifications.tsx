import { useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Bell,
  Key,
  Package,
  AlertTriangle,
  CheckCircle,
  Clock,
  Settings,
  Mail,
  Smartphone,
  Check,
  X,
  Trash2,
} from 'lucide-react';

interface Notification {
  id: string;
  type: 'license' | 'stock' | 'maintenance' | 'approval' | 'system';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  priority: 'high' | 'medium' | 'low';
}

const initialNotifications: Notification[] = [
  { id: '1', type: 'license', title: 'License Expiring Soon', message: 'Adobe Creative Suite expires in 7 days. 5 licenses affected.', timestamp: '2024-03-15T10:30:00', read: false, priority: 'high' },
  { id: '2', type: 'stock', title: 'Low Stock Alert', message: 'Dell Monitor inventory is below minimum threshold (8 remaining).', timestamp: '2024-03-15T09:15:00', read: false, priority: 'high' },
  { id: '3', type: 'approval', title: 'Purchase Approved', message: 'PO-2024-004 has been approved by management.', timestamp: '2024-03-15T08:45:00', read: true, priority: 'medium' },
  { id: '4', type: 'maintenance', title: 'Maintenance Due', message: 'Server room AC maintenance scheduled for tomorrow.', timestamp: '2024-03-14T16:00:00', read: true, priority: 'medium' },
  { id: '5', type: 'system', title: 'System Update', message: 'Inventory system will be updated tonight at 2 AM.', timestamp: '2024-03-14T14:30:00', read: true, priority: 'low' },
  { id: '6', type: 'license', title: 'License Renewed', message: 'Microsoft 365 licenses successfully renewed.', timestamp: '2024-03-14T10:00:00', read: true, priority: 'low' },
];

const typeConfig: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  license: { icon: Key, color: 'bg-warning/10 text-warning' },
  stock: { icon: Package, color: 'bg-destructive/10 text-destructive' },
  maintenance: { icon: AlertTriangle, color: 'bg-info/10 text-info' },
  approval: { icon: CheckCircle, color: 'bg-success/10 text-success' },
  system: { icon: Bell, color: 'bg-primary/10 text-primary' },
};

export default function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [notificationToDelete, setNotificationToDelete] = useState<Notification | null>(null);
  
  // Settings state
  const [settings, setSettings] = useState({
    licenseExpiry: true,
    lowStock: true,
    approvalRequests: true,
    maintenanceReminders: false,
    criticalAlerts: true,
    soundNotifications: false,
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    toast({
      title: 'Marked as read',
      description: 'Notification has been marked as read',
    });
  };

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    toast({
      title: 'All notifications read',
      description: 'All notifications have been marked as read',
    });
  };

  const deleteNotification = (notification: Notification) => {
    setNotificationToDelete(notification);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (notificationToDelete) {
      setNotifications((prev) => prev.filter((n) => n.id !== notificationToDelete.id));
      toast({
        title: 'Notification deleted',
        description: 'Notification has been removed',
      });
    }
    setDeleteDialogOpen(false);
    setNotificationToDelete(null);
  };

  const saveSettings = () => {
    toast({
      title: 'Settings Saved',
      description: 'Your notification preferences have been updated',
    });
  };

  const renderNotification = (notification: Notification) => {
    const config = typeConfig[notification.type];
    const Icon = config.icon;

    return (
      <Card
        key={notification.id}
        className={`transition-all ${
          !notification.read ? 'border-l-4 border-l-primary bg-primary/5' : ''
        }`}
      >
        <CardContent className="pt-4">
          <div className="flex items-start gap-4">
            <div className={`rounded-lg p-2.5 ${config.color}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-semibold">{notification.title}</h4>
                {!notification.read && (
                  <Badge className="bg-primary">New</Badge>
                )}
                <Badge
                  variant="outline"
                  className={
                    notification.priority === 'high'
                      ? 'border-destructive text-destructive'
                      : notification.priority === 'medium'
                      ? 'border-warning text-warning'
                      : ''
                  }
                >
                  {notification.priority}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mb-2">
                {notification.message}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(notification.timestamp).toLocaleString()}
                </span>
                <div className="flex gap-1">
                  {!notification.read && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markAsRead(notification.id)}
                    >
                      <Check className="mr-1 h-4 w-4" />
                      Mark as read
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              className="shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => deleteNotification(notification)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Notifications"
        description="Manage your alerts and notification preferences"
      >
        {unreadCount > 0 && (
          <Button variant="outline" onClick={markAllAsRead}>
            <Check className="mr-2 h-4 w-4" />
            Mark all as read
          </Button>
        )}
      </PageHeader>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all" className="gap-2">
            <Bell className="h-4 w-4" />
            All
            {unreadCount > 0 && (
              <Badge variant="secondary" className="ml-1">
                {unreadCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="unread" className="gap-2">
            Unread
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          {notifications.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                <Bell className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p>No notifications</p>
              </CardContent>
            </Card>
          ) : (
            notifications.map(renderNotification)
          )}
        </TabsContent>

        <TabsContent value="unread" className="space-y-4">
          {notifications.filter((n) => !n.read).length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                <CheckCircle className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p>All caught up! No unread notifications.</p>
              </CardContent>
            </Card>
          ) : (
            notifications.filter((n) => !n.read).map(renderNotification)
          )}
        </TabsContent>

        <TabsContent value="settings" className="space-y-6">
          <Card>
            <CardContent className="pt-6 space-y-6">
              <div>
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Mail className="h-5 w-5" />
                  Email Notifications
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>License Expiry Alerts</Label>
                      <p className="text-sm text-muted-foreground">
                        Get notified when licenses are about to expire
                      </p>
                    </div>
                    <Switch 
                      checked={settings.licenseExpiry} 
                      onCheckedChange={(checked) => setSettings({...settings, licenseExpiry: checked})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Low Stock Alerts</Label>
                      <p className="text-sm text-muted-foreground">
                        Get notified when stock falls below minimum
                      </p>
                    </div>
                    <Switch 
                      checked={settings.lowStock} 
                      onCheckedChange={(checked) => setSettings({...settings, lowStock: checked})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Approval Requests</Label>
                      <p className="text-sm text-muted-foreground">
                        Get notified when there are pending approvals
                      </p>
                    </div>
                    <Switch 
                      checked={settings.approvalRequests} 
                      onCheckedChange={(checked) => setSettings({...settings, approvalRequests: checked})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Maintenance Reminders</Label>
                      <p className="text-sm text-muted-foreground">
                        Get notified about upcoming maintenance
                      </p>
                    </div>
                    <Switch 
                      checked={settings.maintenanceReminders} 
                      onCheckedChange={(checked) => setSettings({...settings, maintenanceReminders: checked})}
                    />
                  </div>
                </div>
              </div>

              <div className="border-t pt-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Smartphone className="h-5 w-5" />
                  In-App Notifications
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Critical Alerts</Label>
                      <p className="text-sm text-muted-foreground">
                        Show immediate notifications for critical events
                      </p>
                    </div>
                    <Switch 
                      checked={settings.criticalAlerts} 
                      onCheckedChange={(checked) => setSettings({...settings, criticalAlerts: checked})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Sound Notifications</Label>
                      <p className="text-sm text-muted-foreground">
                        Play sound for new notifications
                      </p>
                    </div>
                    <Switch 
                      checked={settings.soundNotifications} 
                      onCheckedChange={(checked) => setSettings({...settings, soundNotifications: checked})}
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={saveSettings}>
                  Save Preferences
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Notification</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this notification? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
