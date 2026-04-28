from src.config import loadConfig
from src.bot import runBot


def main() -> None:
    config = loadConfig()
    runBot(config)


if __name__ == "__main__":
    main()
