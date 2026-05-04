import { AdminDevice, PendingDeviceRegistration, Profile } from '../../../../services/api.service';
import { DeviceManager } from './device-manager';

const device = (partial: Partial<AdminDevice>): AdminDevice => ({
  createdAt: '2026-04-01T00:00:00.000Z',
  deviceCode: 'ABC123',
  id: 'device-1',
  name: 'TV Device',
  updatedAt: '2026-04-01T00:00:00.000Z',
  ...partial,
});

const profile = (partial: Partial<Profile>): Profile => ({
  createdAt: '2026-04-01T00:00:00.000Z',
  id: 'profile-1',
  name: 'Lobby',
  playerAccessToken: 'player-token',
  slug: 'lobby',
  updatedAt: '2026-04-01T00:00:00.000Z',
  videoIds: [],
  ...partial,
  orientation: partial.orientation ?? 'landscape',
});

const pendingRegistration = (partial: Partial<PendingDeviceRegistration>): PendingDeviceRegistration => ({
  createdAt: '2026-04-01T00:00:00.000Z',
  expiresAt: '2026-04-01T00:10:00.000Z',
  requestId: 'request-1',
  ...partial,
});

describe('DeviceManager', () => {
  it('emits assign action with selected profileId', () => {
    const component = new DeviceManager();
    const emitted: unknown[] = [];

    component.profiles = [profile({ id: 'profile-1' })];
    component.assignProfile.subscribe((payload) => emitted.push(payload));
    component.emitAssign('device-1', 'profile-1');

    expect(emitted).toEqual([{ deviceId: 'device-1', profileId: 'profile-1' }]);
    expect(component.formError).toBe('');
  });

  it('emits confirm payload with entered pending device code', () => {
    const component = new DeviceManager();
    const emitted: unknown[] = [];
    const pending = pendingRegistration({ requestId: 'request-9' });

    component.confirmPendingDevice.subscribe((payload) => emitted.push(payload));
    component.setPendingEnteredCode('request-9', ' c0d3x9 ');

    component.confirmPending(pending);

    expect(emitted).toEqual([{ requestId: 'request-9', deviceCode: 'C0D3X9' }]);
    expect(component.formError).toBe('');
  });

  it('requires code before confirming pending device', () => {
    const component = new DeviceManager();
    const emitted: unknown[] = [];
    const pending = pendingRegistration({ requestId: 'request-4' });

    component.confirmPendingDevice.subscribe((payload) => emitted.push(payload));
    component.confirmPending(pending);

    expect(emitted).toEqual([]);
    expect(component.formError).toContain('Nhập mã');
  });

  it('requires a profile before assigning', () => {
    const component = new DeviceManager();
    const emitted: unknown[] = [];

    component.assignProfile.subscribe((payload) => emitted.push(payload));
    component.assign(device({ assignedProfileId: undefined }));

    expect(emitted).toEqual([]);
    expect(component.formError).toContain('Chọn màn hình');
  });

  it('emits unassign payload with deviceId object', () => {
    const component = new DeviceManager();
    const emitted: unknown[] = [];
    const currentDevice = device({ id: 'device-9' });

    component.unassignProfile.subscribe((payload) => emitted.push(payload));
    component.unassign(currentDevice);

    expect(emitted).toEqual([{ deviceId: 'device-9' }]);
  });

  it('emits trimmed rename payload', () => {
    const component = new DeviceManager();
    const emitted: unknown[] = [];
    const currentDevice = device({ id: 'device-1', name: 'Old name' });

    component.renameDevice.subscribe((payload) => emitted.push(payload));
    component.startRename(currentDevice);
    component.editingName = '  Lobby TV  ';

    component.saveRename(currentDevice);

    expect(emitted).toEqual([{ deviceId: 'device-1', name: 'Lobby TV' }]);
    expect(component.editingDeviceId).toBeNull();
  });

  it('emits delete payload when confirmed', () => {
    const component = new DeviceManager();
    const emitted: unknown[] = [];
    const currentDevice = device({ id: 'device-7', deviceCode: 'A1B2C3' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    component.deleteDevice.subscribe((payload) => emitted.push(payload));
    component.removeDevice(currentDevice);

    confirmSpy.mockRestore();
    expect(emitted).toEqual([{ deviceId: 'device-7' }]);
  });

  it('tracks selected devices and supports select-all', () => {
    const component = new DeviceManager();
    component.devices = [device({ id: 'device-1' }), device({ id: 'device-2' })];

    component.setDeviceSelected('device-1', true);

    expect(component.isDeviceSelected('device-1')).toBe(true);
    expect(component.hasSelectedDevices()).toBe(true);
    expect(component.areAllDevicesSelected()).toBe(false);

    component.setAllDevicesSelected(true);

    expect(component.areAllDevicesSelected()).toBe(true);

    component.setAllDevicesSelected(false);

    expect(component.hasSelectedDevices()).toBe(false);
  });

  it('emits bulk delete payload with selected device ids when confirmed', () => {
    const component = new DeviceManager();
    const emitted: unknown[] = [];
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    component.devices = [device({ id: 'device-1' }), device({ id: 'device-2' })];
    component.setAllDevicesSelected(true);
    component.deleteDevicesBulk.subscribe((payload) => emitted.push(payload));

    component.removeSelectedDevices();

    confirmSpy.mockRestore();
    expect(emitted).toEqual([{ deviceIds: ['device-1', 'device-2'] }]);
    expect(component.hasSelectedDevices()).toBe(false);
  });

  it('does not emit bulk delete when not confirmed', () => {
    const component = new DeviceManager();
    const emitted: unknown[] = [];
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    component.devices = [device({ id: 'device-1' }), device({ id: 'device-2' })];
    component.setAllDevicesSelected(true);
    component.deleteDevicesBulk.subscribe((payload) => emitted.push(payload));

    component.removeSelectedDevices();

    confirmSpy.mockRestore();
    expect(emitted).toEqual([]);
    expect(component.hasSelectedDevices()).toBe(true);
  });

  it('resolves assigned profile name and online state', () => {
    const component = new DeviceManager();
    component.profiles = [profile({ id: 'profile-1', name: 'Main Lobby' })];

    expect(component.getAssignedProfileName(device({ assignedProfileId: 'profile-1' }))).toBe('Main Lobby');
    expect(component.isOnline(new Date().toISOString())).toBe(true);
    expect(component.isOnline('2020-01-01T00:00:00.000Z')).toBe(false);
  });
});
