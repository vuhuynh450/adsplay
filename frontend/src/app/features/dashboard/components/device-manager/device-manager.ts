import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminDevice, PendingDeviceRegistration, Profile } from '../../../../services/api.service';

export interface AssignDeviceProfilePayload {
  deviceId: string;
  profileId: string;
}

export interface RenameDevicePayload {
  deviceId: string;
  name: string;
}

export interface ConfirmPendingDevicePayload {
  deviceCode: string;
  requestId: string;
}

export interface DeleteDevicesBulkPayload {
  deviceIds: string[];
}

@Component({
  selector: 'app-device-manager',
  imports: [CommonModule, FormsModule],
  templateUrl: './device-manager.html',
})
export class DeviceManager implements OnChanges {
  @Input() devices: AdminDevice[] = [];
  @Input() profiles: Profile[] = [];
  @Input() pendingRegistrations: PendingDeviceRegistration[] = [];

  @Output() confirmPendingDevice = new EventEmitter<ConfirmPendingDevicePayload>();
  @Output() assignProfile = new EventEmitter<AssignDeviceProfilePayload>();
  @Output() unassignProfile = new EventEmitter<{ deviceId: string }>();
  @Output() renameDevice = new EventEmitter<RenameDevicePayload>();
  @Output() deleteDevice = new EventEmitter<{ deviceId: string }>();
  @Output() deleteDevicesBulk = new EventEmitter<DeleteDevicesBulkPayload>();
  @Output() refresh = new EventEmitter<void>();

  private readonly selectedDeviceIds = new Set<string>();
  readonly selectedProfileIds: Record<string, string> = {};
  readonly enteredPendingCodes: Record<string, string> = {};
  editingDeviceId: string | null = null;
  editingName = '';
  formError = '';

  ngOnChanges(changes: SimpleChanges) {
    const validDeviceIds = new Set(this.devices.map((device) => device.id));
    const validProfileIds = new Set(this.profiles.map((profile) => profile.id));
    const validPendingRequestIds = new Set(this.pendingRegistrations.map((item) => item.requestId));

    if (changes['devices']) {
      for (const device of this.devices) {
        this.selectedProfileIds[device.id] = device.assignedProfileId ?? '';
      }
    }

    for (const requestId of validPendingRequestIds) {
      this.enteredPendingCodes[requestId] ??= '';
    }

    for (const deviceId of Object.keys(this.selectedProfileIds)) {
      const selectedProfileId = this.selectedProfileIds[deviceId];

      if (!validDeviceIds.has(deviceId)) {
        delete this.selectedProfileIds[deviceId];
        continue;
      }

      if (selectedProfileId && !validProfileIds.has(selectedProfileId)) {
        delete this.selectedProfileIds[deviceId];
      }
    }

    for (const selectedDeviceId of this.selectedDeviceIds) {
      if (!validDeviceIds.has(selectedDeviceId)) {
        this.selectedDeviceIds.delete(selectedDeviceId);
      }
    }

    for (const requestId of Object.keys(this.enteredPendingCodes)) {
      if (!validPendingRequestIds.has(requestId)) {
        delete this.enteredPendingCodes[requestId];
      }
    }
  }

  isDeviceSelected(deviceId: string) {
    return this.selectedDeviceIds.has(deviceId);
  }

  hasSelectedDevices() {
    return this.selectedDeviceIds.size > 0;
  }

  getSelectedDeviceCount() {
    return this.selectedDeviceIds.size;
  }

  areAllDevicesSelected() {
    return this.devices.length > 0 && this.devices.every((device) => this.selectedDeviceIds.has(device.id));
  }

  setDeviceSelected(deviceId: string, selected: boolean) {
    if (selected) {
      this.selectedDeviceIds.add(deviceId);
      return;
    }

    this.selectedDeviceIds.delete(deviceId);
  }

  setAllDevicesSelected(selected: boolean) {
    if (!selected) {
      this.selectedDeviceIds.clear();
      return;
    }

    for (const device of this.devices) {
      this.selectedDeviceIds.add(device.id);
    }
  }

  toggleDeviceSelectionFromEvent(deviceId: string, event: Event) {
    const target = event.target as HTMLInputElement | null;
    this.setDeviceSelected(deviceId, !!target?.checked);
  }

  toggleAllDevicesFromEvent(event: Event) {
    const target = event.target as HTMLInputElement | null;
    this.setAllDevicesSelected(!!target?.checked);
  }

  getPendingEnteredCode(requestId: string) {
    return this.enteredPendingCodes[requestId] ?? '';
  }

  setPendingEnteredCode(requestId: string, code: string) {
    this.enteredPendingCodes[requestId] = code;
  }

  confirmPending(registration: PendingDeviceRegistration) {
    const enteredCode = this.getPendingEnteredCode(registration.requestId).trim().toUpperCase();
    if (!enteredCode) {
      this.formError = 'Nhập mã trên TV trước khi xác nhận thiết bị mới.';
      return;
    }

    this.formError = '';
    this.confirmPendingDevice.emit({
      deviceCode: enteredCode,
      requestId: registration.requestId,
    });
  }

  getAssignedProfileName(device: AdminDevice) {
    if (!device.assignedProfileId) {
      return 'Chưa gán';
    }

    return this.profiles.find((profile) => profile.id === device.assignedProfileId)?.name || 'Màn hình không tồn tại';
  }

  getSelectedProfileId(device: AdminDevice) {
    return this.selectedProfileIds[device.id] ?? device.assignedProfileId ?? '';
  }

  updateSelectedProfile(deviceId: string, profileId: string) {
    this.selectedProfileIds[deviceId] = profileId;
  }

  emitAssign(deviceId: string, profileId: string) {
    const normalizedProfileId = profileId.trim();
    if (!deviceId || !normalizedProfileId) {
      this.formError = 'Chọn màn hình trước khi gán thiết bị.';
      return;
    }

    if (!this.profiles.some((profile) => profile.id === normalizedProfileId)) {
      this.formError = 'Màn hình đã chọn không còn tồn tại.';
      return;
    }

    this.formError = '';
    this.assignProfile.emit({ deviceId, profileId: normalizedProfileId });
  }

  assign(device: AdminDevice) {
    this.emitAssign(device.id, this.getSelectedProfileId(device));
  }

  unassign(device: AdminDevice) {
    this.formError = '';
    this.selectedProfileIds[device.id] = '';
    this.unassignProfile.emit({ deviceId: device.id });
  }

  startRename(device: AdminDevice) {
    this.editingDeviceId = device.id;
    this.editingName = device.name;
    this.formError = '';
  }

  saveRename(device: AdminDevice) {
    const name = this.editingName.trim();
    if (!name) {
      this.formError = 'Nhập tên thiết bị.';
      return;
    }

    this.renameDevice.emit({ deviceId: device.id, name });
    this.editingDeviceId = null;
    this.editingName = '';
    this.formError = '';
  }

  cancelRename() {
    this.editingDeviceId = null;
    this.editingName = '';
    this.formError = '';
  }

  removeSelectedDevices() {
    const deviceIds = this.devices
      .filter((device) => this.selectedDeviceIds.has(device.id))
      .map((device) => device.id);

    if (!deviceIds.length) {
      this.formError = 'Chọn ít nhất 1 thiết bị để xóa.';
      return;
    }

    this.formError = '';
    if (typeof window !== 'undefined') {
      const accepted = window.confirm(`Xóa ${deviceIds.length} thiết bị đã chọn?`);
      if (!accepted) {
        return;
      }
    }

    this.selectedDeviceIds.clear();
    this.deleteDevicesBulk.emit({ deviceIds });
  }

  removeDevice(device: AdminDevice) {
    this.formError = '';
    if (typeof window !== 'undefined') {
      const accepted = window.confirm(`Xóa thiết bị "${device.name}" (${device.deviceCode})?`);
      if (!accepted) {
        return;
      }
    }

    this.selectedDeviceIds.delete(device.id);
    this.deleteDevice.emit({ deviceId: device.id });
  }

  isOnline(lastSeen?: string) {
    if (!lastSeen) {
      return false;
    }

    return Date.now() - new Date(lastSeen).getTime() < 60000;
  }

  formatLastSeen(lastSeen?: string) {
    return lastSeen ? new Date(lastSeen).toLocaleString() : 'Chưa kết nối';
  }
}
