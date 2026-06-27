import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';

interface CustomReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const dataFields = [
  { id: 'assetName', label: 'Asset Name', category: 'Asset' },
  { id: 'serialNumber', label: 'Serial Number', category: 'Asset' },
  { id: 'category', label: 'Category', category: 'Asset' },
  { id: 'status', label: 'Status', category: 'Asset' },
  { id: 'value', label: 'Value', category: 'Asset' },
  { id: 'assignedTo', label: 'Assigned To', category: 'User' },
  { id: 'department', label: 'Department', category: 'User' },
  { id: 'purchaseDate', label: 'Purchase Date', category: 'Financial' },
  { id: 'vendor', label: 'Vendor', category: 'Financial' },
  { id: 'purchaseOrder', label: 'Purchase Order', category: 'Financial' },
];

export function CustomReportDialog({ open, onOpenChange }: CustomReportDialogProps) {
  const [reportName, setReportName] = useState('');
  const [selectedFields, setSelectedFields] = useState<string[]>(['assetName', 'status']);
  const [groupBy, setGroupBy] = useState('');
  const [sortBy, setSortBy] = useState('');

  const handleFieldToggle = (fieldId: string) => {
    setSelectedFields(prev =>
      prev.includes(fieldId)
        ? prev.filter(f => f !== fieldId)
        : [...prev, fieldId]
    );
  };

  const handleCreate = () => {
    if (!reportName) {
      toast({
        title: 'Error',
        description: 'Please enter a report name',
        variant: 'destructive',
      });
      return;
    }

    if (selectedFields.length === 0) {
      toast({
        title: 'Error',
        description: 'Please select at least one field',
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Custom Report Created',
      description: `${reportName} has been created with ${selectedFields.length} fields`,
    });
    
    setReportName('');
    setSelectedFields(['assetName', 'status']);
    setGroupBy('');
    setSortBy('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Create Custom Report</DialogTitle>
          <DialogDescription>
            Build a customized report tailored to your specific needs. Select the data fields you want to include, choose grouping and sorting options, and name your report for easy identification. Custom reports can combine asset, user, and financial data to provide unique insights for your organization's decision-making process.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4 max-h-[400px] overflow-y-auto">
          <div className="grid gap-2">
            <Label htmlFor="reportName">Report Name</Label>
            <Input
              id="reportName"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              placeholder="My Custom Report"
            />
          </div>
          
          <div className="grid gap-2">
            <Label>Select Fields</Label>
            <div className="border rounded-lg p-3 space-y-3">
              {['Asset', 'User', 'Financial'].map(category => (
                <div key={category}>
                  <p className="text-sm font-medium text-muted-foreground mb-2">{category}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {dataFields
                      .filter(f => f.category === category)
                      .map(field => (
                        <div key={field.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={field.id}
                            checked={selectedFields.includes(field.id)}
                            onCheckedChange={() => handleFieldToggle(field.id)}
                          />
                          <Label htmlFor={field.id} className="font-normal text-sm">
                            {field.label}
                          </Label>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Group By</Label>
              <Select value={groupBy} onValueChange={setGroupBy}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="category">Category</SelectItem>
                  <SelectItem value="department">Department</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Sort By</Label>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="name-asc">Name (A-Z)</SelectItem>
                  <SelectItem value="name-desc">Name (Z-A)</SelectItem>
                  <SelectItem value="value-asc">Value (Low-High)</SelectItem>
                  <SelectItem value="value-desc">Value (High-Low)</SelectItem>
                  <SelectItem value="date-asc">Date (Oldest)</SelectItem>
                  <SelectItem value="date-desc">Date (Newest)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate}>
            Create Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
