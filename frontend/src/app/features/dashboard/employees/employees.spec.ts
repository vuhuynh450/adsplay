import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService, EmployeeView } from '../../../services/api.service';
import { Employees } from './employees';

const employee = (partial: Partial<EmployeeView>): EmployeeView => ({
  allowedPages: ['videos'],
  createdAt: '2026-05-01T00:00:00.000Z',
  id: 'employee-1',
  isActive: true,
  mustChangePassword: true,
  role: 'staff',
  updatedAt: '2026-05-01T00:00:00.000Z',
  username: 'staff',
  ...partial,
});

describe('Employees', () => {
  let apiServiceStub: {
    getEmployees: ReturnType<typeof vi.fn>;
    deleteEmployeesBulk: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    apiServiceStub = {
      getEmployees: vi.fn(() => of([])),
      deleteEmployeesBulk: vi.fn(() => of({ deletedCount: 0 })),
    };

    await TestBed.configureTestingModule({
      imports: [Employees],
      providers: [{ provide: ApiService, useValue: apiServiceStub }],
    }).compileComponents();
  });

  it('keeps the page wrapper flush with the dashboard content container', () => {
    const fixture = TestBed.createComponent(Employees);
    fixture.componentInstance.loading.set(false);
    fixture.detectChanges();

    const wrapper = fixture.nativeElement.firstElementChild as HTMLElement;

    expect(wrapper.classList.contains('space-y-6')).toBe(true);
    expect(wrapper.classList.contains('px-4')).toBe(false);
    expect(wrapper.classList.contains('md:px-6')).toBe(false);
    expect(wrapper.classList.contains('p-4')).toBe(false);
    expect(wrapper.classList.contains('md:p-6')).toBe(false);
  });

  it('tracks selected employees and supports select-all', () => {
    const fixture = TestBed.createComponent(Employees);
    const component = fixture.componentInstance;
    component.employees.set([
      employee({ id: 'employee-1' }),
      employee({ id: 'employee-2' }),
    ]);

    component.setEmployeeSelected('employee-1', true);

    expect(component.isEmployeeSelected('employee-1')).toBe(true);
    expect(component.hasSelectedEmployees()).toBe(true);
    expect(component.getSelectedEmployeeCount()).toBe(1);
    expect(component.areAllEmployeesSelected()).toBe(false);

    component.setAllEmployeesSelected(true);

    expect(component.areAllEmployeesSelected()).toBe(true);
    expect(component.getSelectedEmployeeCount()).toBe(2);

    component.setAllEmployeesSelected(false);

    expect(component.hasSelectedEmployees()).toBe(false);
  });

  it('bulk deletes selected employees after confirmation and reloads the list', () => {
    const fixture = TestBed.createComponent(Employees);
    const component = fixture.componentInstance;
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    apiServiceStub.getEmployees.mockClear();
    apiServiceStub.deleteEmployeesBulk.mockReturnValue(of({ deletedCount: 2 }));
    component.employees.set([
      employee({ id: 'employee-1' }),
      employee({ id: 'employee-2' }),
    ]);
    component.setAllEmployeesSelected(true);

    component.deleteSelectedEmployees();

    confirmSpy.mockRestore();
    expect(apiServiceStub.deleteEmployeesBulk).toHaveBeenCalledWith(['employee-1', 'employee-2']);
    expect(apiServiceStub.getEmployees).toHaveBeenCalledTimes(1);
    expect(component.hasSelectedEmployees()).toBe(false);
    expect(component.formError).toBe('');
  });

  it('does not bulk delete when confirmation is cancelled', () => {
    const fixture = TestBed.createComponent(Employees);
    const component = fixture.componentInstance;
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    component.employees.set([employee({ id: 'employee-1' })]);
    component.setAllEmployeesSelected(true);

    component.deleteSelectedEmployees();

    confirmSpy.mockRestore();
    expect(apiServiceStub.deleteEmployeesBulk).not.toHaveBeenCalled();
    expect(component.isEmployeeSelected('employee-1')).toBe(true);
  });
});
