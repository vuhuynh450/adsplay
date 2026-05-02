import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render shared shell outlets', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
    expect(compiled.querySelector('app-toast-outlet')).toBeTruthy();
  });

  it('redirects /player to /device', () => {
    const playerRoute = routes.find((route) => route.path === 'player');

    expect(playerRoute?.redirectTo).toBe('device');
    expect(playerRoute?.pathMatch).toBe('full');
    expect(playerRoute?.component).toBeUndefined();
  });
});
