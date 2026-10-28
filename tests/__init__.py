
"""Package-mode tests also default to isolated legacy server configuration."""
import os
os.environ["POKESIFT_CLOUD_ENABLED"]="0"
