import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { Role } from './decorators/roles.decorator';

interface User {
  id: number;
  email: string;
  passwordHash: string;
  role: Role;
}

@Injectable()
export class AuthService {
  private users: User[] = []; 
  private nextId = 1;

  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async signup(dto: SignupDto) {
    const email = dto.email.toLowerCase();
    if (this.users.some((u) => u.email === email)) {
      throw new ConflictException('Email already registered');
    }
    const adminEmail = this.config.get<string>('ADMIN_EMAIL')?.toLowerCase();
    const role: Role = email === adminEmail ? 'admin' : 'user';
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user: User = { id: this.nextId++, email, passwordHash, role };
    this.users.push(user);
    return { id: user.id, email: user.email, role: user.role };
  }

  async login(dto: LoginDto) {
    const user = this.users.find((u) => u.email === dto.email.toLowerCase());
    const valid = user && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    let payload: { sub: number };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const user = this.users.find((u) => u.id === payload.sub);
    if (!user) throw new UnauthorizedException('Invalid refresh token');
    return this.issueTokens(user);
  }

  listUsers() {
    return this.users.map(({ passwordHash, ...safe }) => safe);
  }

  private async issueTokens(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload), 
      this.jwtService.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      }),
    ]);
    return { accessToken, refreshToken };
  }
}