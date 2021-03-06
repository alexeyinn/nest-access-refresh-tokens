import { ForbiddenException, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Tokens } from "./types/tokens.type";
import * as bcrypt from "bcrypt";
import { AuthDto } from "./dto";
import { InjectRepository } from "@nestjs/typeorm";
import { UserEntity } from "./entities";
import { Repository } from "typeorm";

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private jwtService: JwtService
  ) {}

  async sighupLocal(dto: AuthDto): Promise<Tokens> {
    const hash = await this.hashData(dto.password);

    let newUser;
    try {
      newUser = await this.userRepository.save({ ...dto, hash });
    } catch {
      throw new ForbiddenException("This email is already taken!");
    }

    const tokens = await this.getTokens(newUser.id, newUser.email);
    await this.updateRtHash(newUser.id, tokens.refresh_token);

    return tokens;
  }

  async sighinLocal(dto: AuthDto): Promise<Tokens> {
    const user = await this.userRepository.findOne({
      where: { email: dto.email },
    });

    if (!user)
      throw new ForbiddenException("User with this email is not exist!");

    const passwordMatches = await bcrypt.compare(dto.password, user.hash);
    if (!passwordMatches) throw new ForbiddenException("Wrong password!");

    const tokens = await this.getTokens(user.id, user.email);
    await this.updateRtHash(user.id, tokens.refresh_token);
    return tokens;
  }

  async logout(userId: number): Promise<boolean> {
    await this.userRepository.save({ id: userId, hashedRt: null });
    return true;
  }

  async refreshTokens(userId: number, rt: string) {
    const user = await this.userRepository.findOne({
      where: {
        id: userId,
      },
    });

    if (!user || !user.hashedRt)
      throw new ForbiddenException("User with this email is not exist!");

    const rtMatches = await bcrypt.compare(rt, user.hashedRt);
    if (!rtMatches) throw new ForbiddenException("Access denied!");

    const tokens = await this.getTokens(user.id, user.email);
    await this.updateRtHash(user.id, tokens.refresh_token);
    return tokens;
  }

  private async getTokens(userId: number, email: string): Promise<Tokens> {
    const [at, rt] = await Promise.all([
      this.jwtService.signAsync(
        {
          sub: userId,
          email,
        },
        {
          secret: "at-secret",
          expiresIn: 60 * 15,
        }
      ),
      this.jwtService.signAsync(
        {
          sub: userId,
          email,
        },
        {
          secret: "rt-secret",
          expiresIn: 60 * 60 * 24 * 7,
        }
      ),
    ]);

    return { access_token: at, refresh_token: rt };
  }

  private hashData(data: string) {
    return bcrypt.hash(data, 5);
  }

  private async updateRtHash(userId: number, rt: string) {
    const hash = await this.hashData(rt);
    await this.userRepository.save({ id: userId, hashedRt: hash });
  }
}
